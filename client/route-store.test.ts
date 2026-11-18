import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouteStore } from "./route-store.ts";
import {
  auxiliaryKindLabel,
  byteLabel, durationLabel, routePillLabels, connectingRoute, type RouteState,
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
  }, (state) => labels.push(routePillLabels(state).model ?? "实际路由"));
  assert.equal(starts, 0);
  const icon = store.subscribe(() => {});
  const popover = store.subscribe(() => {});
  assert.equal(starts, 1);
  emit(live);
  assert.equal(store.getSnapshot(), live);
  assert.equal(labels.at(-1), "actual");
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
  assert.equal(routePillLabels(live).model, "actual");
  assert.equal(routePillLabels({ ...live, route: { ...live.route!, model: undefined } }).model, "路由中");
  assert.equal(routePillLabels({ ...live, route: { ...live.route!, kind: "title", done: true } }).provider, "辅助 · vendor");
  assert.equal(routePillLabels({ ...live, route: { ...live.route!, done: true, status: 500 } }).traffic, "失败");
  assert.equal(durationLabel(), "未提供");
  assert.equal(durationLabel(0), "0 ms");
  assert.equal(durationLabel(700), "700 ms");
  assert.equal(durationLabel(1234), "1.23 s");
});

test("translates known auxiliary request kinds and preserves unknown kinds", () => {
  assert.equal(auxiliaryKindLabel("compact"), "上下文压缩");
  assert.equal(auxiliaryKindLabel("collab_spawn"), "子任务协作");
  assert.equal(auxiliaryKindLabel("title"), "生成标题");
  assert.equal(auxiliaryKindLabel("future_kind"), "future_kind");
});

test("byte labels update across B/KB/MB without dropping the provider or inventing missing counts", () => {
  for (const [bytes, expected] of [[0, "0 B"], [12, "12 B"], [1023, "1023 B"], [1024, "1.0 KB"],
    [1536, "1.5 KB"], [1048576, "1.0 MB"], [3145728, "3.0 MB"]] as const) {
    assert.equal(byteLabel(bytes), expected);
    assert.equal(routePillLabels({ ...live, route: { ...live.route!, bytes } }).traffic, expected);
  }
  for (const bytes of [undefined, NaN, Infinity, -1, 0.5]) assert.equal(byteLabel(bytes), "未提供");
  assert.equal(routePillLabels({ ...live, route: { ...live.route!, bytes: 12, done: true } }).traffic, "12 B");
});

test("native pill values separate provider, model and bytes to avoid the host's 160px cap", () => {
  assert.deepEqual(routePillLabels({ ...live, route: { ...live.route!, model: "kurumiai/gpt-6.1-sol", bytes: 12345 } }), {
    provider: "kurumiai", model: "gpt-6.1-sol", traffic: "12.1 KB",
  });
  assert.deepEqual(routePillLabels(connectingRoute), { provider: "实际路由" });
  assert.deepEqual(routePillLabels({ ...live, route: { ...live.route!, model: undefined } }), {
    provider: "实际路由", model: "路由中", traffic: "字节未提供",
  });
  assert.equal(routePillLabels({ ...live, route: { ...live.route!, done: true, error: "upstream failed", bytes: 0 } }).traffic, "0 B · 失败");
});
