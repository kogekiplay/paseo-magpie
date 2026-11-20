import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const historyPeriods = ["today", "7d", "30d"] as const;
export const historyPageSizes = [30, 50, 100] as const;
export const historyProtocols = ["Anthropic", "Responses", "Chat", "Gemini"] as const;
export const historyAccessTypes = ["subscription", "api"] as const;

const comparisonId = z.string().regex(/^[a-f0-9]{64}$/);
const historyError = z.object({ state: z.enum(["forbidden", "unsupported", "unavailable"]) });

export const historyInput = z.object({
  period: z.enum(historyPeriods),
  offset: z.number().int().nonnegative().safe(),
  limit: z.literal(historyPageSizes).optional(),
  route: comparisonId.optional(),
  refresh: z.boolean().optional(),
}).strict();

const historyRow = z.object({
  time: z.number().int().positive().safe(),
  agent: z.string(),
  provider: z.string(),
  model: z.string(),
  requestedModel: z.string().optional(),
  account: z.string().optional(),
  access: z.enum(historyAccessTypes).optional(),
  protocol: z.object({
    upstream: z.enum(historyProtocols),
    client: z.enum(historyProtocols).optional(),
    websocket: z.boolean(),
  }).optional(),
  inputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  cacheHit: z.number().min(0).max(1).optional(),
  costUsd: z.number().nonnegative().optional(),
  credits: z.number().nonnegative().optional(),
  status: z.number().int().optional(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  ttftMs: z.number().positive().optional(),
  durationMs: z.number().positive().optional(),
  speed: z.object({ tps: z.number().positive(), lowerBound: z.boolean() }).optional(),
  session: z.object({ agentId: z.string().min(1), title: z.string() }).optional(),
});

export const historyOutput = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    rows: z.array(historyRow).max(Math.max(...historyPageSizes)),
    offset: z.number().int().nonnegative().safe(),
    total: z.number().int().nonnegative().safe(),
  }),
  historyError,
]);

const comparisonInput = z.object({
  period: z.enum(historyPeriods),
  refresh: z.boolean().optional(),
}).strict();

const comparisonProvider = z.object({
  id: comparisonId,
  name: z.string(),
  requests: z.number().int().positive(),
  ttft: z.object({ p50: z.number().positive(), p90: z.number().positive(), count: z.number().int().positive() }).optional(),
  speed: z.object({ p50: z.number().positive(), count: z.number().int().positive() }).optional(),
});

const comparisonOutput = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    limitedTo: z.number().int().positive().optional(),
    models: z.array(z.object({ id: comparisonId, name: z.string(), providers: z.array(comparisonProvider) })),
  }),
  historyError,
]);

export const getHistory = defineRpc({ name: "history.list", input: historyInput, output: historyOutput });
export const getComparison = defineRpc({ name: "history.compare", input: comparisonInput, output: comparisonOutput });

export type HistoryInput = z.infer<typeof historyInput>;
export type HistoryOutput = z.infer<typeof historyOutput>;
export type HistoryRow = z.infer<typeof historyRow>;
export type HistoryPageSize = (typeof historyPageSizes)[number];
export type ComparisonInput = z.infer<typeof comparisonInput>;
export type ComparisonOutput = z.infer<typeof comparisonOutput>;
export type ComparisonProvider = z.infer<typeof comparisonProvider>;
