import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { routeFailed, routePillLabels, supportsRoute, watchRoute, type RouteState } from "../shared/route.ts";
import { createRouteStore, type RouteStore } from "./route-store.ts";
import { createByteAnimation } from "./byte-animation.ts";

interface AgentTarget {
  id: string;
  workspaceId?: string | null;
  provider: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  archivedAt?: string | null;
}

export function contributeRoutes(
  client: PluginClientContext,
  createRouteSurfaces: (store: RouteStore) => {
    RouteIcon: import("react").ComponentType<import("@getpaseo/plugin/client").PluginButtonIconProps>;
    RouteContent: import("react").ComponentType<import("@getpaseo/plugin/client").PluginButtonContentProps>;
  },
) {
  const lifetime = new AbortController();
  const entries = new Map<string, {
    workspaceId: string; provider: string; pills: PluginButtonRegistration[]; store: RouteStore;
    animation: ReturnType<typeof createByteAnimation>;
    keepAlive?: () => void;
  }>();
  const remove = (agentId: string) => {
    const entry = entries.get(agentId);
    if (!entry) return;
    entries.delete(agentId);
    entry.animation.dispose();
    entry.keepAlive?.();
    entry.store.dispose();
    for (const pill of entry.pills) pill.remove();
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
    if (existing?.workspaceId === agent.workspaceId && existing.provider === agent.provider) {
      const shouldKeepAlive = agent.status === "initializing" || agent.status === "running";
      if (shouldKeepAlive && !existing.keepAlive) existing.keepAlive = existing.store.subscribe(() => {});
      if (!shouldKeepAlive && existing.keepAlive) {
        existing.keepAlive();
        existing.keepAlive = undefined;
      }
      return;
    }
    remove(agent.id);
    const input = { agentId: agent.id, workspaceId: agent.workspaceId };
    const pills: PluginButtonRegistration[] = [];
    const presentation: { label: string; visible: boolean }[] = [];
    const update = (index: number, label: string, visible: boolean) => {
      const previous = presentation[index];
      if (previous?.label === label && previous.visible === visible) return;
      presentation[index] = { label, visible };
      pills[index]?.update({ label, visible });
    };
    let latest: RouteState | undefined;
    const animation = createByteAnimation((bytes) => {
      if (!latest) return;
      const animated = latest.route ? { ...latest, route: { ...latest.route, bytes } } : latest;
      const labels = routePillLabels(animated);
      update(1, labels.traffic ?? "接收大小", Boolean(latest.route && !latest.route.done && !routeFailed(latest.route)));
    });
    const store = createRouteStore((emit, closed) => {
      const subscription = client.subscribe(watchRoute, input, emit, { onClosed: closed });
      void subscription.ready.catch(closed);
      return () => { subscription(); };
    }, (state) => {
      latest = state;
      const labels = routePillLabels(state);
      const route = state.route;
      const active = Boolean(route && !route.done && !routeFailed(route));
      update(0, labels.provider, active);
      update(2, labels.model ?? "模型", active);
      animation.update(route ? `${route.id}:${route.time}` : undefined, route?.bytes, active);
    });
    const { RouteIcon, RouteContent } = createRouteSurfaces(store);
    for (const part of [
      { id: "route", label: "实际路由", icon: RouteIcon, interactive: true },
      { id: "route-traffic", label: "接收大小", icon: "Download", interactive: false },
      { id: "route-model", label: "模型", icon: "Cpu", interactive: false },
    ]) {
      pills.push(client.addComposerPill({
        id: part.id, workspaceId: agent.workspaceId, agentId: agent.id,
        button: {
          title: "查看实际路由详情",
          label: part.label, icon: part.icon, visible: false,
          disabled: !part.interactive,
          behavior: part.interactive
            ? { kind: "popover", Content: RouteContent }
            : { kind: "action", onPress() {} },
        },
      }));
    }
    const entry: {
      workspaceId: string;
      provider: string;
      pills: PluginButtonRegistration[];
      store: RouteStore;
      animation: ReturnType<typeof createByteAnimation>;
      keepAlive?: () => void;
    } = { workspaceId: agent.workspaceId, provider: agent.provider, pills, store, animation };
    entries.set(agent.id, entry);
    if (agent.status === "initializing" || agent.status === "running") {
      entry.keepAlive = store.subscribe(() => {});
    }
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
