import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginHookContext, PluginHookPayload } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
import { replyRouteKind, type ReplyRoute } from "../shared/reply-route.ts";
import { readCodexReplyRoute } from "./codex-reply-route.ts";
import { readConfig } from "./config.ts";
import { redact } from "./source.ts";
import { fetchTrace, isLoopbackGateway, traceSchema } from "./traffic.ts";

const seat = z.object({ id: z.string(), provider: z.string() });
const traceReplySchema = z.object({
  agent: z.string(),
  session: z.string(),
  responseId: z.string().optional(),
  kind: z.string().optional(),
  sub: z.string().optional(),
  subagentId: z.string().optional(),
  done: z.boolean(),
  canceled: z.boolean().optional(),
  error: z.string().optional(),
  status: z.number().int().optional(),
  provider: z.string(),
  order: z.array(seat),
  left: z.array(seat).optional(),
  tries: z.array(z.object({
    id: z.string(),
    model: z.string().optional(),
    served: z.string().optional(),
    done: z.boolean(),
    status: z.number().int().optional(),
    error: z.string().optional(),
    fail: z.string().optional(),
  })),
});

export function matchReplyRoute(body: unknown, session: string, messageId: string, key?: string): ReplyRoute | null {
  if (!session || !messageId) return null;
  const trace = traceSchema.safeParse(body);
  if (!trace.success) return null;

  const matches = trace.data.routes.flatMap((value) => {
    const row = traceReplySchema.safeParse(value);
    if (!row.success) return [];
    const route = row.data;
    return route.agent === "claude" && route.session === session && route.responseId === messageId
      && !route.kind && !route.sub && !route.subagentId ? [route] : [];
  });
  if (matches.length !== 1) return null;

  const row = matches[0];
  if (!row.done || row.canceled || row.error || row.status === undefined || row.status < 200 || row.status >= 300) return null;
  const seats = [...row.order, ...(row.left ?? [])];
  const attempts = row.tries.map((attempt) => ({
    provider: seats.find(({ id }) => id === attempt.id)?.provider ?? row.provider,
    model: attempt.served || attempt.model,
    status: attempt.status,
    failed: !attempt.done || Boolean(attempt.error || attempt.fail) || (attempt.status ?? 0) >= 400,
  }));
  const last = attempts.at(-1);
  if (!last?.provider || !last.model || last.failed) return null;

  const safe = (value: string) =>
    redact(value, key).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 150) || "[已隐藏]";
  return {
    provider: safe(last.provider),
    model: safe(last.model),
    attempts: attempts.slice(-30).map((attempt) => ({
      route: attempt.model ? `${safe(attempt.provider)}/${safe(attempt.model)}` : safe(attempt.provider),
      ...(attempt.status === undefined ? {} : { status: attempt.status }),
      failed: attempt.failed,
    })),
  };
}

export function finalReplyId(
  entries: readonly { item: AgentTimelineItem; turnId?: string | null }[], turnId: string,
): string | undefined {
  const latest = entries.findLast((entry) => entry.item.type !== "plugin");
  if (latest?.turnId !== turnId) return;
  const reply = entries.findLast(({ item, turnId: entryTurn }) =>
    entryTurn === turnId
      && (item.type === "tool_call" || (item.type === "assistant_message" && item.text.trim())),
  )?.item;
  if (reply?.type === "assistant_message") return reply.messageId;
}

export async function recordReplyRoute(
  { agent, turnId, outcome }: PluginHookPayload<"agent.turn.after">,
  { paseo, signal }: PluginHookContext,
) {
  if ((agent.provider !== "claude" && agent.provider !== "codex") || !turnId || outcome.kind !== "completed") return;
  const ref = paseo.agents.ref(agent.id);
  const latestReplyId = async () => {
    // Other turn-end hooks can append rows without a turn ID before ours runs.
    const page = await ref.timeline.refetch({ direction: "tail", limit: 20 });
    return finalReplyId(page.entries, turnId);
  };

  try {
    const config = await readConfig();
    if (!isLoopbackGateway(config.url) || signal.aborted) return;
    const messageId = await latestReplyId();
    if (!messageId) return;
    const session = ref.runtimeInfo?.sessionId;
    if (!session || signal.aborted) return;

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(config.timeoutMs, 2_000));
    let route: ReplyRoute | null = null;
    try {
      // The reply can complete before Magpie closes the trace or runs its response hook.
      const waits = agent.provider === "codex" ? [0, 150, 350, 750] : [0, 150, 350];
      for (const wait of waits) {
        if (wait) await delay(wait, undefined, { signal: controller.signal });
        if (agent.provider === "codex") {
          route = await readCodexReplyRoute(session, messageId, controller.signal);
          if (route) {
            // Magpie runs completion hooks asynchronously; an earlier request can be indexed after the final one.
            if (route.requests) {
              try {
                await delay(650, undefined, { signal: controller.signal });
                const refreshed = await readCodexReplyRoute(session, messageId, controller.signal);
                if (!controller.signal.aborted) route = refreshed;
              } catch {
                // Keep the anchored result when the optional refresh times out.
              }
            }
            break;
          }
          continue;
        }
        const response = await fetchTrace(config, controller.signal, fetch);
        if (!response.ok) return;
        route = matchReplyRoute(await response.json(), session, messageId, config.apiKey);
        if (route) break;
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
    if (!route || signal.aborted) return;
    if (await latestReplyId() !== messageId || ref.runtimeInfo?.sessionId !== session || signal.aborted) return;

    const id = createHash("sha256").update(turnId).update("\0").update(messageId).digest("hex");
    await ref.timeline.append({ type: "plugin", id, kind: replyRouteKind, version: 1, data: route });
  } catch {
    // The route is optional. Suppress fetch bodies, credentials and SDK error payloads.
  }
}
