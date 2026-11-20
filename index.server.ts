import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMagpieUsageSource } from "./server/source.ts";
import { handleRouteWatch } from "./server/route.ts";
import { recordReplyRoute } from "./server/reply-route.ts";
import { watchRoute } from "./shared/route.ts";
import { getComparison, getHistory, getTrend } from "./shared/history.ts";
import { createHistoryReader } from "./server/history.ts";
import { createHistoryComparison } from "./server/history-comparison.ts";
import { gatewaySettings, readGatewaySettings, saveGatewaySettings } from "./shared/gateway-settings.ts";
import { createGatewayConfiguration } from "./server/gateway-settings.ts";

export default function contribute(server: PluginServerContext) {
  const gateway = createGatewayConfiguration(server.registerSettings(gatewaySettings));
  const config = gateway.config;
  server.handle(readGatewaySettings, gateway.read);
  server.handle(saveGatewaySettings, gateway.save);
  server.registerUsageSource(createMagpieUsageSource({ config }));
  server.handle(watchRoute, (input, context) => handleRouteWatch(input, context, config));
  const readHistory = createHistoryReader(config);
  const comparison = createHistoryComparison(config);
  server.handle(getHistory, (input, { paseo }) => {
    const read = input.route ? comparison.details : readHistory;
    return read(input, (options) => paseo.agents.list(options));
  });
  server.handle(getComparison, comparison.compare);
  server.handle(getTrend, comparison.trend);
  return server.addHook("agent.turn.after", (payload, context) => recordReplyRoute(payload, context, config));
}
