import { defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

const text = z.string();
export const routeTrySchema = z.object({
  model: text,
  effort: text.optional(),
  tier: text.optional(),
  tier_served: text.optional(),
  done: z.boolean(),
  status: z.number().int().optional(),
  fail: text.optional(),
  ms: z.number().nonnegative().optional(),
});

export const routeSchema = z.object({
  id: z.number().int(),
  time: z.iso.datetime({ offset: true }),
  kind: text.optional(),
  asked: text,
  asked_effort: text.optional(),
  asked_tier: text.optional(),
  group: text.optional(),
  model: text.optional(),
  effort: text.optional(),
  tier: text.optional(),
  tier_served: text.optional(),
  served: text.optional(),
  tries: z.array(routeTrySchema),
  done: z.boolean(),
  status: z.number().int().optional(),
  error: text.optional(),
  ms: z.number().nonnegative().optional(),
  ttft_ms: z.number().nonnegative().optional(),
  bytes: z.number().int().nonnegative().safe().optional(),
  contentAt: z.number().int().nonnegative().safe().optional(),
});

export const routeInputSchema = z.object({
  agentId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(200),
}).strict();

export const routeStateSchema = z.object({
  state: z.enum([
    "connecting", "waiting_session", "waiting_route", "ready",
    "unsupported", "unavailable", "error",
  ]),
  message: text,
  route: routeSchema.nullable(),
});

export const watchRoute = defineSubscription({
  name: "route.watch",
  input: routeInputSchema,
  event: routeStateSchema,
});

export type SessionRoute = z.infer<typeof routeSchema>;
export type RouteInput = z.infer<typeof routeInputSchema>;
export type RouteState = z.infer<typeof routeStateSchema>;

export const connectingRoute: RouteState = {
  state: "connecting", message: "正在关联当前会话…", route: null,
};

export function supportsRoute(provider: string): boolean {
  return provider === "codex" || provider === "claude";
}

export function routeFailed(route: SessionRoute): boolean {
  return Boolean(route.error) || (route.done && (route.status ?? 0) >= 400);
}

/** Native composer pills have a host-owned 160px cap. Keep their independent values separate
 * so response size cannot be ellipsized behind a long provider/model path. */
export function routePillLabels(state: RouteState): { provider: string; model?: string; traffic?: string } {
  const route = state.route;
  if (!route) return { provider: state.state === "error" ? "路由离线" : "实际路由" };
  const actual = route.model;
  const slash = actual?.indexOf("/") ?? -1;
  const provider = actual && slash > 0 ? actual.slice(0, slash) : "实际路由";
  const model = actual && slash > 0 ? actual.slice(slash + 1) : actual || (route.done ? "未知模型" : "路由中");
  return {
    provider: `${route.kind ? "辅助 · " : ""}${provider}`,
    model,
    traffic: routeFailed(route) ? `${route.bytes === undefined ? "" : `${byteLabel(route.bytes)} · `}失败`
      : route.bytes === undefined ? "字节未提供" : byteLabel(route.bytes),
  };
}

export function byteLabel(bytes?: number): string {
  if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) return "未提供";
  // Same 1024-based boundaries and one decimal as Magpie's routing view, with familiar units.
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function durationLabel(ms?: number): string {
  if (ms === undefined) return "未提供";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
