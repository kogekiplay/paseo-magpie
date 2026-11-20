import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeRoutes } from "./client/contribute.tsx";
import { contributeReplyRoutes } from "./client/reply-route.tsx";
import { contributeSettings } from "./client/settings.tsx";
import { contributeHistory } from "./client/history.tsx";

export default function contribute(client: PluginClientContext) {
  const removeRoutes = contributeRoutes(client);
  const removeReplyRoutes = contributeReplyRoutes(client);
  const removeSettings = contributeSettings(client);
  const removeHistory = contributeHistory(client);
  return () => {
    removeHistory();
    removeSettings();
    removeReplyRoutes();
    removeRoutes();
  };
}
