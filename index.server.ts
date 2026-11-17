import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMagpieUsageSource } from "./server/source.ts";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource(createMagpieUsageSource());
  return () => {};
}
