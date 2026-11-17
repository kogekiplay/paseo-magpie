import { connectingRoute, type RouteState } from "../shared/route.ts";

export interface RouteStore {
  getSnapshot(): RouteState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** One gateway subscription shared by a visible composer icon and its open popover.
 * It starts on mount, stops on the last unmount, and never observes background agents. */
export function createRouteStore(
  start: (emit: (state: RouteState) => void, closed: () => void) => () => void,
  onState: (state: RouteState) => void,
): RouteStore {
  let snapshot = connectingRoute;
  let stop: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (state: RouteState) => {
    snapshot = state;
    onState(state);
    for (const listener of listeners) listener();
  };
  const release = () => {
    generation++;
    stop?.();
    stop = undefined;
    snapshot = connectingRoute;
    onState(snapshot);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) {
        const current = ++generation;
        const active = () => !disposed && generation === current && listeners.size > 0;
        stop = start(
          (state) => { if (active()) publish(state); },
          () => { if (active()) publish({
            state: "error", route: null, message: "路由连接已断开，重连后自动更新。",
          }); },
        );
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && !disposed) release();
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      release();
      listeners.clear();
    },
  };
}
