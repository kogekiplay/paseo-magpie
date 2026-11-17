import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrafficReader, isLoopbackGateway, matchTraffic } from "./traffic.ts";
import { createRouteReader, createRouteWatcher } from "./route.ts";
import { type RouteState, type SessionRoute } from "../shared/route.ts";

const session = "synthetic-native-session";
const route: SessionRoute = {
  id: 15, time: "2026-01-01T00:00:00Z", asked: "group/requested",
  model: "vendor/actual", done: false, tries: [{ model: "vendor/actual", done: false }],
};
const row = {
  id: route.id, time: route.time, session, model: route.asked, provider: "vendor", done: false,
  bytes: 12, contentAt: 1000, tries: [{ id: "synthetic-account", model: "actual", done: false }],
  order: [{ id: "synthetic-account", provider: "vendor" }],
  account: "account@example.test", private: "secret-trace-text",
};
const trace = (rows: unknown[] = [row]) => ({ object: "trace", routes: rows });
const config = { url: "http://127.0.0.1:3425/prefix/", timeoutMs: 100, apiKey: "synthetic-key" };
const input = { agentId: "test-agent", workspaceId: "test-workspace" };
const agent = { workspaceId: input.workspaceId, provider: "codex", sessionId: session, archived: false };

test("copies only counters from the exact session, request ID, time and attempted model", () => {
  const result = matchTraffic(trace(), session, route);
  assert.equal(result.bytes, 12);
  assert.equal(result.contentAt, 1000);
  assert.equal(result.model, route.model);
  for (const privateValue of ["account@example.test", "secret-trace-text", "synthetic-account", session]) {
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test("never matches another session, reused request ID, old timestamp or an advanced fallback", () => {
  for (const patch of [
    { session: "another-session" }, { id: 99 }, { time: "2026-01-02T00:00:00Z" },
    { model: "other/request" }, { done: true }, { tries: [] },
    { tries: [{ id: "synthetic-account", model: "different-model", done: false }] },
    { tries: [{ id: "synthetic-account", model: "actual", done: true }] },
    { order: [{ id: "synthetic-account", provider: "different-vendor" }] },
  ]) {
    assert.equal(matchTraffic(trace([{ ...row, ...patch }]), session, route), route);
  }
});

test("a matching trace's omitted zero stays distinct from unavailable telemetry", () => {
  assert.equal(matchTraffic(trace([{ ...row, bytes: undefined, contentAt: undefined }]), session, route).bytes, 0);
  for (const body of [null, { routes: [row] }, trace([]), trace([{ ...row, bytes: -1 }]),
    trace([{ ...row, bytes: "12" }]), trace([{ ...row, bytes: 1.5 }])]) {
    assert.equal(matchTraffic(body, session, route).bytes, undefined);
  }
  assert.equal(matchTraffic(trace([null, { ...row, id: 1 }, row]), session, route).bytes, 12);
});

test("fallback seat providers use order, then left, then the route's provider", () => {
  assert.equal(matchTraffic(trace([{ ...row, order: [], left: row.order }]), session, route).bytes, 12);
  assert.equal(matchTraffic(trace([{ ...row, order: [] }]), session, route).bytes, 12);
  assert.equal(matchTraffic(trace([{ ...row, order: [{ id: "synthetic-account", provider: "" }] }]), session, route).bytes, undefined);
});

test("full traces are queried only on a loopback gateway", async () => {
  for (const url of ["http://localhost:3425/", "http://127.0.0.1:3425/", "http://127.1.2.3/", "http://[::1]:3425/"]) {
    assert.equal(isLoopbackGateway(url), true);
  }
  const read = createTrafficReader(async () => { throw new Error("must not query trace"); });
  for (const url of ["https://magpie.example.test/", "http://192.168.1.20:3425/", "http://localhost.example.test/", "http://127.0.0.1.example.test/"]) {
    assert.equal(isLoopbackGateway(url), false);
    assert.equal(await read({ ...config, url }, session, route, new AbortController().signal), route);
  }
});

test("uses the configured key and proxy prefix, blocks redirects, and cools down refused telemetry", async () => {
  let calls = 0;
  const read = createTrafficReader(async (url, options) => {
    calls++;
    assert.equal(String(url), "http://127.0.0.1:3425/prefix/v1/magpie/trace");
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${config.apiKey}`);
    assert.equal(options?.redirect, "error");
    return new Response("private gateway refusal", { status: 403 });
  });
  for (let n = 0; n < 2; n++) assert.equal(await read(config, session, route, new AbortController().signal), route);
  assert.equal(calls, 1);
  await read({ ...config, apiKey: "changed-key" }, session, route, new AbortController().signal);
  assert.equal(calls, 2);
});

test("session route byte telemetry takes precedence and does not need the local trace", async () => {
  let calls = 0;
  const read = createTrafficReader(async () => { calls++; return Response.json(trace()); });
  const direct = { ...route, bytes: 0 };
  assert.equal(await read(config, session, direct, new AbortController().signal), direct);
  assert.equal(calls, 0);
});

test("a cancelled trace request aborts and never replaces the known route", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const read = createTrafficReader(async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => { cancelled = true; reject(new Error("aborted")); }, { once: true });
    controller.abort();
  }));
  assert.equal(await read(config, session, route, controller.signal), route);
  assert.equal(cancelled, true);
});

test("late trace replies are discarded if the agent changes its native session", async () => {
  let current = agent;
  const read = createRouteReader({
    resolve: async () => current, config: async () => config,
    request: async (url) => {
      if (String(url).includes("/trace")) {
        current = { ...agent, sessionId: "replacement-native-session" };
        return Response.json(trace());
      }
      return Response.json({ session, seq: 1, route });
    },
  });
  const result = await read(input, new AbortController().signal);
  assert.equal(result.state.route, null);
  assert.equal(result.state.state, "connecting");
});

test("live trace counters are republished even when the session route body stays unchanged", async () => {
  const controller = new AbortController();
  let bytes = 12;
  const states: RouteState[] = [];
  const watch = createRouteWatcher({
    resolve: async () => agent, config: async () => config,
    request: async (url) => String(url).includes("/trace")
      ? Response.json(trace([{ ...row, bytes }])) : Response.json({ session, seq: 1, route }),
    pause: async () => { bytes = bytes === 12 ? 2048 : 3145728; },
  });
  await watch(input, {
    signal: controller.signal, push: async (state) => {
      states.push(state);
      if (states.length === 3) controller.abort();
    },
  });
  assert.deepEqual(states.map((state) => state.route?.bytes), [12, 2048, 3145728]);
  assert.ok(states.every((state) => state.route?.model === "vendor/actual"));
});

test("unavailable optional trace preserves session routing and never fabricates zero bytes", async () => {
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async (url) => String(url).includes("/trace")
      ? new Response("private trace failure", { status: 500 }) : Response.json({ session, seq: 1, route }),
  });
  const result = await read(input, new AbortController().signal);
  assert.equal(result.state.state, "ready");
  assert.equal(result.state.route?.model, "vendor/actual");
  assert.equal(result.state.route?.bytes, undefined);
});
