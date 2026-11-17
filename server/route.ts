import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import type { PluginSubscriptionContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  routeSchema, supportsRoute,
  type RouteInput, type RouteState, type SessionRoute,
} from "../shared/route.ts";
import { readConfig, type MagpieConfig } from "./config.ts";
import { redact } from "./source.ts";

const responseSchema = z.object({
  session: z.string(),
  seq: z.number().int().nonnegative(),
  route: routeSchema.nullable(),
});

// This structural boundary keeps tests independent of provider internals and stored agent files.
export interface RouteAgent {
  workspaceId: string | null;
  provider: string;
  sessionId: string | null;
  archived: boolean;
}

interface Dependencies {
  resolve(input: RouteInput): Promise<RouteAgent | null>;
  config?: () => Promise<MagpieConfig>;
  request?: typeof fetch;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}

class RouteError extends Error {}

function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("路由订阅已取消。");
}

function identity(agent: RouteAgent | null, input: RouteInput): string | null {
  if (!agent || agent.workspaceId !== input.workspaceId || agent.archived
    || !supportsRoute(agent.provider)) return null;
  const session = agent.sessionId;
  // Magpie truncates session IDs at 128 bytes; reject rather than query a different identity.
  if (!session || session.trim() !== session || Buffer.byteLength(session) > 128) return null;
  return session;
}

function waiting(agent: RouteAgent | null, input: RouteInput): RouteState {
  if (!agent || agent.workspaceId !== input.workspaceId || agent.archived) {
    return { state: "unavailable", message: "当前会话已关闭或不属于此工作区。", route: null };
  }
  if (!supportsRoute(agent.provider)) {
    return { state: "unsupported", message: "目前支持 Codex 和 Claude Code。", route: null };
  }
  return { state: "waiting_session", message: "等待会话启动后关联 Magpie。", route: null };
}

function safeRoute(route: SessionRoute, key?: string): SessionRoute {
  // Provider failure messages can contain URLs, tokens or account details. Keep only safe codes.
  // Model names are still passed through credential redaction.
  const safe = (value: string | undefined) => value === undefined ? undefined : redact(value, key);
  return {
    ...route,
    asked: safe(route.asked)!,
    model: safe(route.model),
    served: safe(route.served),
    group: safe(route.group),
    error: route.error ? "上游请求失败，详情请在 Magpie 中查看。" : undefined,
    tries: route.tries.map((attempt) => ({
      ...attempt,
      model: safe(attempt.model)!,
      fail: attempt.fail ? "此尝试失败，详情请在 Magpie 中查看。" : undefined,
    })),
  };
}

export function createRouteReader(deps: Dependencies) {
  const loadConfig = deps.config ?? readConfig;
  const request = deps.request ?? fetch;
  return async (
    input: RouteInput, signal: AbortSignal, cursor?: { session: string; seq: number },
  ): Promise<{ state: RouteState; seq?: number; session?: string }> => {
    const agent = await deps.resolve(input);
    checkAborted(signal);
    const session = identity(agent, input);
    if (!session) return { state: waiting(agent, input) };
    const config = await loadConfig();
    checkAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, config.timeoutMs);
    try {
      const url = new URL("v1/magpie/route", config.url);
      url.searchParams.set("session", session);
      // Bound the long poll so quiet gateways cannot delay identity checks for a minute.
      if (cursor?.session === session && config.timeoutMs >= 3_000) {
        url.searchParams.set("after", String(cursor.seq));
        url.searchParams.set("wait", "2");
      }
      const response = await request(url, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const detail = [401, 403].includes(response.status)
          ? "请检查网关密钥与路由读取权限。"
          : response.status === 404 ? "请升级支持会话路由接口的 Magpie。" : "请稍后重试。";
        throw new RouteError(`Magpie 路由读取失败（HTTP ${response.status}），${detail}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new RouteError("Magpie 返回了无效的路由数据。");
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new RouteError("Magpie 路由格式不兼容，请检查网关版本。");
      if (parsed.data.session !== session) throw new RouteError("Magpie 返回的会话不匹配，已忽略此路由。");

      // Refresh again after the network response: reopening/moving/deleting an agent may happen
      // while the request is in flight. A late response must never be published into a new session.
      const current = await deps.resolve(input);
      checkAborted(signal);
      if (identity(current, input) !== session || current?.provider !== agent?.provider) {
        return { state: identity(current, input)
          ? { state: "connecting", message: "会话已变化，正在重新关联…", route: null }
          : waiting(current, input) };
      }
      const route = parsed.data.route;
      return {
        session,
        seq: parsed.data.seq,
        state: route ? {
          state: "ready", message: "当前会话最近一次请求", route: safeRoute(route, config.apiKey),
        } : {
          state: "waiting_route", route: null,
          message: "暂无当前会话的近期路由。确认会话经 Magpie 发出请求后等待更新；较早记录可能已被网关清理。",
        },
      };
    } catch (error) {
      checkAborted(signal);
      if (controller.signal.aborted) throw new RouteError("读取 Magpie 路由超时，正在重试。");
      if (error instanceof RouteError) throw error;
      // Never send raw fetch errors, URLs or upstream response bodies to the client.
      throw new RouteError("无法连接 Magpie，正在重试。");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
}

export function createRouteWatcher(deps: Dependencies) {
  const read = createRouteReader(deps);
  const pause = deps.pause ?? ((ms, signal) => delay(ms, undefined, { signal }));
  return async (input: RouteInput, context: Pick<PluginSubscriptionContext<RouteState>, "push" | "signal">) => {
    let cursor: { session: string; seq: number } | undefined;
    let lastEvent: string | undefined;
    const publish = async (state: RouteState) => {
      const event = JSON.stringify(state);
      if (event === lastEvent || context.signal.aborted) return;
      await context.push(state);
      lastEvent = event;
    };
    while (!context.signal.aborted) {
      let interval = 1_000;
      try {
        // The reader resolves identity again; after is only a polling hint, never a session selector.
        const result = await read(input, context.signal, cursor);
        if (context.signal.aborted) return;
        cursor = result.session && result.seq !== undefined
          ? { session: result.session, seq: result.seq } : undefined;
        await publish(result.state);
        if (!cursor) interval = 1_500;
      } catch (error) {
        if (context.signal.aborted) return;
        cursor = undefined;
        await publish({
          state: "error", route: null,
          message: error instanceof RouteError ? error.message : "暂时无法读取当前会话路由，正在重试。",
        });
        interval = 5_000;
      }
      try {
        await pause(interval, context.signal);
      } catch {
        if (context.signal.aborted) return;
        throw new Error("路由订阅已停止。");
      }
    }
  };
}

export function handleRouteWatch(input: RouteInput, context: PluginSubscriptionContext<RouteState>) {
  const watch = createRouteWatcher({
    resolve: async ({ agentId }) => {
      const agent = context.paseo.agents.ref(agentId);
      const result = await agent.refresh();
      if (!result) return null;
      return {
        workspaceId: agent.workspaceId,
        provider: agent.current()?.provider ?? agent.runtimeInfo?.provider ?? "",
        sessionId: agent.runtimeInfo?.sessionId ?? null,
        archived: Boolean(agent.archivedAt),
      };
    },
  });
  return watch(input, context);
}
