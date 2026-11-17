import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMagpieUsageSource } from "./server/source.ts";
import { handleRouteWatch } from "./server/route.ts";
import { watchRoute } from "./shared/route.ts";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource(createMagpieUsageSource());
  server.handle(watchRoute, handleRouteWatch);
  return () => {};
}
