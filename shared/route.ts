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

const auxiliaryKindNames: Record<string, string> = {
  guardian: "审批检查",
  auto_review: "自动审查",
  guardian_review: "审批检查",
  review: "审查",
  compact: "上下文压缩",
  memory_consolidation: "记忆整理",
  memgen: "记忆整理",
  memory: "记忆整理",
  thread_title: "生成标题",
  thread_title_reconsideration: "重新生成标题",
  title_generation: "生成标题",
  title: "生成标题",
  thread_description: "生成描述",
  composer_predictions: "输入预测",
  collab_spawn: "子任务协作",
  thread_spawn: "子任务协作",
  agent_job: "子任务协作",
  luna_reserve: "Luna 预留",
  ambient_suggestions: "智能建议",
  ambient_suggestion_safety: "智能建议安全检查",
  web_search: "网页搜索",
  vision: "图像理解",
  routing: "路由分类",
  connection_check: "连接检查",
  provider_test: "供应商测试",
  api_detect: "检测 API",
  model_list: "模型列表",
  mcp_tool: "MCP 工具",
  keepalive: "连接保活",
  agent_summary: "进度摘要",
  agent_summary_inferred: "进度摘要（推断）",
  auto_mode_check: "自动模式检查",
  auto_mode_check_inferred: "自动模式检查（推断）",
};

export function auxiliaryKindLabel(kind: string): string {
  return auxiliaryKindNames[kind] ?? kind;
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
