import { z } from "zod";

export const replyRouteKind = "reply-route";
export const replyRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  attempts: z.array(z.object({
    route: z.string().min(1),
    status: z.number().int().optional(),
    failed: z.boolean(),
  })).min(1),
});

export type ReplyRoute = z.infer<typeof replyRouteSchema>;
