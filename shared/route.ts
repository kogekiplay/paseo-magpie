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

export function routeLabel(state: RouteState): string {
  if (state.state === "error") return "路由离线";
  const route = state.route;
  if (!route) return "路由";
  // Never substitute the requested model for one Magpie actually attempted.
  const actual = route.model?.replace(/^[^/]+\//, "");
  const label = actual || (route.done ? "路由未知" : "路由中");
  const compact = label.length > 30 ? `${label.slice(0, 29)}…` : label;
  return `${route.kind ? "辅助 · " : ""}${compact}${routeFailed(route) ? " · 失败" : route.done ? "" : " …"}`;
}

export function durationLabel(ms?: number): string {
  if (ms === undefined) return "未提供";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
