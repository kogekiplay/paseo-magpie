import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeRoutes as register } from "./route-pills.ts";
import { createRouteSurfaces } from "./route-view.tsx";

export function contributeRoutes(client: PluginClientContext) {
  return register(client, createRouteSurfaces);
}
