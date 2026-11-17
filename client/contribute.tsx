import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { routeLabel, supportsRoute, watchRoute } from "../shared/route.ts";
import { createRouteStore, type RouteStore } from "./route-store.ts";
import { createRouteSurfaces } from "./route-view.tsx";

interface AgentTarget {
  id: string;
  workspaceId?: string | null;
  provider: string;
  archivedAt?: string | null;
}

export function contributeRoutes(client: PluginClientContext) {
  const lifetime = new AbortController();
  const entries = new Map<string, {
    workspaceId: string; provider: string; pill: PluginButtonRegistration; store: RouteStore;
  }>();
  const remove = (agentId: string) => {
    const entry = entries.get(agentId);
    if (!entry) return;
    entries.delete(agentId);
    entry.store.dispose();
    entry.pill.remove();
  };
  const register = (agent: AgentTarget) => {
    if (lifetime.signal.aborted) return;
    if (!agent.workspaceId || agent.archivedAt || !supportsRoute(agent.provider)) {
      remove(agent.id);
      return;
    }
    const existing = entries.get(agent.id);
    // Preserve the component identity and behavior during status/streaming updates. Replacing
    // either closes an open popover and would churn the route subscription on every agent update.
    if (existing?.workspaceId === agent.workspaceId && existing.provider === agent.provider) return;
    remove(agent.id);
    const input = { agentId: agent.id, workspaceId: agent.workspaceId };
    let pill: PluginButtonRegistration | undefined;
    const store = createRouteStore((emit, closed) => {
      const subscription = client.subscribe(watchRoute, input, emit, { onClosed: closed });
      void subscription.ready.catch(closed);
      return () => { subscription(); };
    }, (state) => {
      pill?.update({ label: routeLabel(state) });
    });
    const { RouteIcon, RouteContent } = createRouteSurfaces(store);
    pill = client.addComposerPill({
      id: "route", workspaceId: agent.workspaceId, agentId: agent.id,
      button: {
        title: "查看当前会话的 Magpie 实际路由",
        label: "路由",
        icon: RouteIcon,
        behavior: { kind: "popover", Content: RouteContent },
      },
    });
    entries.set(agent.id, { workspaceId: agent.workspaceId, provider: agent.provider, pill, store });
  };
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: ({ entries: agents }) => {
          const alive = new Set(agents.map(({ agent }) => agent.id));
          for (const id of entries.keys()) if (!alive.has(id)) remove(id);
          for (const { agent } of agents) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.agent);
          else remove(update.agentId);
        },
      });
    }).catch(() => {
      if (!lifetime.signal.aborted) console.error("Magpie: 无法观察会话列表。");
    });
  return () => {
    lifetime.abort();
    for (const id of entries.keys()) remove(id);
  };
}
