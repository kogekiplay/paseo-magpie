import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouteStore } from "./route-store.ts";
import {
  durationLabel, routeLabel, connectingRoute, type RouteState,
} from "../shared/route.ts";

const live: RouteState = {
  state: "ready", message: "当前会话最近一次请求",
  route: {
    id: 1, time: "2026-01-01T00:00:00Z", asked: "group/requested",
    model: "vendor/actual", done: false, tries: [],
  },
};

test("a mounted icon and popover share one stream; last unmount cancels it", () => {
  let starts = 0;
  let stops = 0;
  let emit!: (state: RouteState) => void;
  const labels: string[] = [];
  const store = createRouteStore((onState) => {
    starts++;
    emit = onState;
    return () => { stops++; };
  }, (state) => labels.push(routeLabel(state)));
  assert.equal(starts, 0);
  const icon = store.subscribe(() => {});
  const popover = store.subscribe(() => {});
  assert.equal(starts, 1);
  emit(live);
  assert.equal(store.getSnapshot(), live);
  assert.equal(labels.at(-1), "actual …");
  icon();
  assert.equal(stops, 0);
  popover();
  assert.equal(stops, 1);
  assert.equal(store.getSnapshot(), connectingRoute);
  emit(live);
  assert.equal(store.getSnapshot(), connectingRoute);
});

test("remounts and removed registrations ignore delayed responses from old subscriptions", () => {
  const emissions: ((state: RouteState) => void)[] = [];
  let stops = 0;
  const store = createRouteStore((emit) => {
    emissions.push(emit);
    return () => { stops++; };
  }, () => {});
  const unmount = store.subscribe(() => {});
  unmount();
  store.subscribe(() => {});
  emissions[0](live);
  assert.equal(store.getSnapshot(), connectingRoute);
  emissions[1](live);
  assert.equal(store.getSnapshot(), live);
  store.dispose();
  store.dispose();
  emissions[1](live);
  assert.equal(store.getSnapshot(), connectingRoute);
  assert.equal(stops, 2);
});

test("disconnects clear the route instead of keeping an apparently live model", () => {
  let closed!: () => void;
  const store = createRouteStore((emit, onClosed) => {
    closed = onClosed;
    emit(live);
    return () => {};
  }, () => {});
  store.subscribe(() => {});
  closed();
  assert.equal(store.getSnapshot().state, "error");
  assert.equal(store.getSnapshot().route, null);
  store.dispose();
});

test("each agent owns its own state even when requests finish out of order", () => {
  const emissions: ((state: RouteState) => void)[] = [];
  const create = () => createRouteStore((emit) => {
    emissions.push(emit);
    return () => {};
  }, () => {});
  const first = create();
  const second = create();
  first.subscribe(() => {});
  second.subscribe(() => {});
  emissions[1]({ state: "waiting_route", message: "暂无", route: null });
  emissions[0](live);
  assert.equal(second.getSnapshot().route, null);
  assert.equal(first.getSnapshot().route?.model, "vendor/actual");
  first.dispose();
  second.dispose();
});

test("labels distinguish actual, pending, failed and auxiliary routes", () => {
  assert.equal(routeLabel(live), "actual …");
  assert.equal(routeLabel({ ...live, route: { ...live.route!, model: undefined } }), "路由中 …");
  assert.equal(routeLabel({ ...live, route: { ...live.route!, kind: "title", done: true } }), "辅助 · actual");
  assert.equal(routeLabel({ ...live, route: { ...live.route!, done: true, status: 500 } }), "actual · 失败");
  assert.equal(durationLabel(), "未提供");
  assert.equal(durationLabel(0), "0 ms");
  assert.equal(durationLabel(700), "700 ms");
  assert.equal(durationLabel(1234), "1.23 s");
});
