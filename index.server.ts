import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMagpieUsageSource } from "./server/source.ts";
import { handleRouteWatch } from "./server/route.ts";
import { recordReplyRoute } from "./server/reply-route.ts";
import { watchRoute } from "./shared/route.ts";
import { getHistory } from "./shared/history.ts";
import { createHistoryReader } from "./server/history.ts";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource(createMagpieUsageSource());
  server.handle(watchRoute, handleRouteWatch);
  const readHistory = createHistoryReader();
  server.handle(getHistory, (input, { paseo }) => readHistory(input, (options) => paseo.agents.list(options)));
  return server.addHook("agent.turn.after", recordReplyRoute);
}
