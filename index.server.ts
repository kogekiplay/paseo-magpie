import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMagpieUsageSource } from "./server/source.ts";
import { handleRouteWatch } from "./server/route.ts";
import { recordReplyRoute } from "./server/reply-route.ts";
import { watchRoute } from "./shared/route.ts";
import { getComparison, getHistory, getTrend } from "./shared/history.ts";
import { createHistoryReader } from "./server/history.ts";
import { createHistoryComparison } from "./server/history-comparison.ts";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource(createMagpieUsageSource());
  server.handle(watchRoute, handleRouteWatch);
  const readHistory = createHistoryReader();
  const comparison = createHistoryComparison();
  server.handle(getHistory, (input, { paseo }) => {
    const read = input.route ? comparison.details : readHistory;
    return read(input, (options) => paseo.agents.list(options));
  });
  server.handle(getComparison, comparison.compare);
  server.handle(getTrend, comparison.trend);
  return server.addHook("agent.turn.after", recordReplyRoute);
}
