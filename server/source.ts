import { createHash } from "node:crypto";
import {
  hashAccountKey,
  unavailable,
  type UsageAccount,
  type UsageReport,
  type UsageSourceRegistration,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import { readConfig, type MagpieConfig } from "./config.ts";
import { accountKey, accountLabel, quotaReport, responseSchema, type MagpieQuota } from "./quota.ts";
import { aggregateReport, groupKey, quotaGroups } from "./aggregate.ts";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), key: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("aggregate"), key: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("gateway") }).strict(),
]);

interface Snapshot {
  config: MagpieConfig;
  quotas: MagpieQuota[];
}

interface Dependencies {
  config?: () => Promise<MagpieConfig>;
  request?: typeof fetch;
  now?: () => number;
}

export function redact(message: string, secret?: string): string {
  const safe = secret ? message.split(secret).join("[已隐藏]") : message;
  return safe.replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[已隐藏]").slice(0, 1_000);
}

export function createMagpieUsageSource(deps: Dependencies = {}): UsageSourceRegistration {
  const loadConfig = deps.config ?? readConfig;
  const request = deps.request ?? fetch;
  const now = deps.now ?? Date.now;
  // One batch serves discovery and concurrent account fetches. Paseo owns the long-lived cache.
  let cached: { fingerprint: string; at: number; value: Snapshot } | undefined;
  let flight: { fingerprint: string; promise: Promise<Snapshot> } | undefined;

  async function snapshot(): Promise<Snapshot> {
    const config = await loadConfig();
    const fingerprint = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    if (cached?.fingerprint === fingerprint && now() - cached.at < 1_000) return cached.value;
    if (flight?.fingerprint === fingerprint) return flight.promise;
    const promise = (async () => {
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        response = await request(new URL("v1/magpie/quotas", config.url), {
          method: "GET",
          headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) {
          const remedy = [401, 403].includes(response.status) ? "，请检查网关密钥与访问权限" : "";
          throw new Error(`Magpie 额度读取失败（HTTP ${response.status}）${remedy}。`);
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error("Magpie 返回了无效的额度数据，请检查网关地址与版本。");
        }
        const parsed = responseSchema.safeParse(body);
        if (!parsed.success) throw new Error("Magpie 额度数据格式不兼容，请检查 Magpie 版本。");
        const value = {
          config,
          quotas: parsed.data.data.map((quota) => ({
            ...quota,
            error: quota.error ? redact(quota.error, config.apiKey) : undefined,
          })),
        };
        cached = { fingerprint, at: now(), value };
        return value;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("读取 Magpie 额度超时，请稍后刷新。");
        }
        // Never forward fetch errors, response bodies, URLs or authorization headers.
        if (error instanceof TypeError) {
          throw new Error("无法连接 Magpie，请确认网关已启动且地址正确。");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })();
    flight = { fingerprint, promise };
    try {
      return await promise;
    } finally {
      if (flight?.promise === promise) flight = undefined;
    }
  }

  async function report(input: unknown): Promise<UsageReport> {
    const selected = inputSchema.parse(input);
    try {
      const { config, quotas } = await snapshot();
      if (selected.kind === "gateway") {
        return unavailable({
          kind: "no_quota",
          detail: quotas.length
            ? "Magpie 已连接，请刷新额度列表以发现账号。"
            : "Magpie 暂无额度账号，请先在 Magpie 中添加账号或配置余额。",
        });
      }
      const groups = quotaGroups(config.url, quotas);
      if (selected.kind === "aggregate") {
        const group = groups.find((item) => item.key === selected.key);
        return group ? aggregateReport(group, now()) : unavailable({
          kind: "no_quota", detail: "当前网关已没有这组多账号额度，请刷新额度列表。",
        });
      }
      const quota = quotas.find((item) => accountKey(config.url, item) === selected.key);
      if (!quota) {
        return unavailable({ kind: "no_quota", detail: "此账号已不在当前 Magpie 网关中，请刷新额度列表。" });
      }
      const group = groups.find((item) => item.key === groupKey(config.url, quota));
      const hasAggregate = group && aggregateReport(group, now()).status === "available";
      return quotaReport(quota, { summary: !hasAggregate });
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error.message : "Magpie 额度读取失败。" };
    }
  }

  return {
    id: "magpie",
    label: "Magpie",
    icon: "assets/magpie.svg",
    input: inputSchema,
    discover: async (scope) => {
      // A gateway can route one session across several accounts. Global discovery must not leak
      // those accounts into an agent's popover, whose scope represents exactly one login.
      if (scope.kind !== "global") return [];
      try {
        const { config, quotas } = await snapshot();
        const accounts = new Map<string, UsageAccount>();
        for (const group of quotaGroups(config.url, quotas)) {
          accounts.set(group.key, {
            key: group.key,
            label: group.name,
            harness: "Magpie",
            input: { kind: "aggregate", key: group.key },
          });
        }
        for (const quota of quotas) {
          const key = accountKey(config.url, quota);
          accounts.set(key, {
            key,
            label: accountLabel(quota),
            harness: "Magpie",
            input: { kind: "account", key },
          });
        }
        if (accounts.size) return [...accounts.values()];
      } catch {
        // A discover() failure would silently hide the integration. Retain a visible status card.
      }
      return [{
        key: hashAccountKey("magpie-gateway"),
        label: "Magpie",
        harness: "Magpie",
        input: { kind: "gateway" },
      }];
    },
    fetch: report,
  };
}
