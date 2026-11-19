import { URL } from "node:url";
import { isIP } from "node:net";
import { z } from "zod";
import type { SessionRoute } from "../shared/route.ts";
import type { MagpieConfig } from "./config.ts";

const count = z.number().int().nonnegative().safe();
const attemptSchema = z.object({
  id: z.string(), model: z.string().optional(), done: z.boolean(),
});
const seatSchema = z.object({ id: z.string(), provider: z.string() });
const traceRouteSchema = z.object({
  id: count,
  time: z.string(),
  session: z.string(),
  model: z.string(),
  provider: z.string(),
  done: z.boolean(),
  bytes: count.optional(),
  contentAt: count.optional(),
  tries: z.array(attemptSchema),
  order: z.array(seatSchema),
  left: z.array(seatSchema).optional(),
});
export const traceSchema = z.object({ object: z.literal("trace"), routes: z.array(z.unknown()) });

export function isLoopbackGateway(value: string): boolean {
  const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

export function fetchTrace(config: MagpieConfig, signal: AbortSignal, request: typeof fetch) {
  return request(new URL("v1/magpie/trace", config.url), {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    redirect: "error", signal,
  });
}

/** Trace is local-only and contains unrelated accounts. Whitelist just the counters of the
 * exact session/request we already resolved; never forward a trace row or infer from "latest". */
export function matchTraffic(body: unknown, session: string, route: SessionRoute): SessionRoute {
  const parsed = traceSchema.safeParse(body);
  if (!parsed.success) return route;
  for (const value of parsed.data.routes) {
    const item = traceRouteSchema.safeParse(value);
    if (!item.success) continue;
    const row = item.data;
    if (row.session !== session || row.id !== route.id || row.time !== route.time
      || row.model !== route.asked || row.done !== route.done
      || row.tries.length !== route.tries.length) continue;
    // Fallbacks may advance between the route and trace reads. Do not attach their counters
    // to a stale provider/model. Reproduce Magpie's provider resolution for every attempt.
    const sameAttempts = row.tries.every((attempt, index) => {
      const provider = [...row.order, ...(row.left ?? [])]
        .find((seat) => seat.id === attempt.id)?.provider ?? row.provider;
      const model = provider && attempt.model ? `${provider}/${attempt.model}` : attempt.model || "";
      return model === route.tries[index].model && attempt.done === route.tries[index].done;
    });
    if (!sameAttempts) continue;
    return {
      ...route,
      // Magpie's Route.bytes uses omitempty: a matching supported trace with no bytes means 0.
      bytes: row.bytes ?? 0,
      contentAt: row.contentAt || undefined,
    };
  }
  return route;
}

export function createTrafficReader(request: typeof fetch = fetch) {
  // A refused/old endpoint is optional telemetry, not a reason to hide a valid route or retry
  // an administrative endpoint every half second. Re-evaluate after a short cooldown.
  let refused: { url: string; key?: string; until: number } | undefined;
  return async (
    config: MagpieConfig, session: string, route: SessionRoute, signal: AbortSignal,
  ): Promise<SessionRoute> => {
    if (route.bytes !== undefined || !isLoopbackGateway(config.url) || signal.aborted) return route;
    if (refused?.url === config.url && refused.key === config.apiKey && refused.until > Date.now()) return route;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(2_000, config.timeoutMs));
    try {
      const response = await fetchTrace(config, controller.signal, request);
      if (!response.ok) {
        refused = { url: config.url, key: config.apiKey, until: Date.now() + 30_000 };
        return route;
      }
      return matchTraffic(await response.json(), session, route);
    } catch {
      return route;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
}
