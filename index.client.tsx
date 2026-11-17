import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeRoutes } from "./client/contribute.tsx";

export default function contribute(client: PluginClientContext) {
  return contributeRoutes(client);
}
