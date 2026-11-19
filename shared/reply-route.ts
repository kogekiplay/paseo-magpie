import { z } from "zod";

export const replyRouteKind = "reply-route";
export const requestRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  attempts: z.array(z.object({
    route: z.string().min(1),
    status: z.number().int().optional(),
    failed: z.boolean(),
  })).min(1),
});

export const requestPhaseSchema = z.enum(["tool", "model", "reply"]);
export const replyRouteSchema = requestRouteSchema.extend({
  requests: z.array(requestRouteSchema.extend({ phase: requestPhaseSchema })).min(1).optional(),
  truncated: z.boolean().optional(),
  turnOnly: z.boolean().optional(),
});

export type RequestRoute = z.infer<typeof requestRouteSchema>;
export type ReplyRoute = z.infer<typeof replyRouteSchema>;
