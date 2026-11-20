import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const historyPeriods = ["today", "7d", "30d"] as const;
export const historyAgents = ["codex", "claude"] as const;
export const historyPageSize = 30;

export const historyInput = z.object({
  period: z.enum(historyPeriods),
  agent: z.enum(historyAgents),
  offset: z.number().int().nonnegative().safe(),
}).strict();

const historyRow = z.object({
  time: z.number().int().positive().safe(),
  provider: z.string(),
  model: z.string(),
  status: z.number().int().optional(),
  outcome: z.enum(["completed", "failed", "canceled"]),
  ttftMs: z.number().positive().optional(),
  durationMs: z.number().positive().optional(),
  speed: z.object({ tps: z.number().positive(), lowerBound: z.boolean() }).optional(),
});

export const historyOutput = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    rows: z.array(historyRow).max(historyPageSize),
    offset: z.number().int().nonnegative().safe(),
    total: z.number().int().nonnegative().safe(),
  }),
  z.object({ state: z.enum(["forbidden", "unsupported", "unavailable"]) }),
]);

export const getHistory = defineRpc({ name: "history.list", input: historyInput, output: historyOutput });

export type HistoryInput = z.infer<typeof historyInput>;
export type HistoryOutput = z.infer<typeof historyOutput>;
export type HistoryRow = z.infer<typeof historyRow>;
