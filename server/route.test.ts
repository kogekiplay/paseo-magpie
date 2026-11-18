import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouteReader, createRouteWatcher, type RouteAgent } from "./route.ts";
import { routeStateSchema, type RouteState, type SessionRoute } from "../shared/route.ts";

const input = { agentId: "test-agent", workspaceId: "test-workspace" };
const config = { url: "https://gateway.example.test/proxy/", timeoutMs: 100, apiKey: "test-gateway-key" };
const agent: RouteAgent = {
  workspaceId: input.workspaceId, provider: "codex", sessionId: "native-session-A", archived: false,
};
const route: SessionRoute = {
  id: 7, time: "2026-01-01T02:03:04Z", asked: "group/test",
  model: "test-vendor/actual-model", done: true, status: 200,
  tries: [{ model: "test-vendor/actual-model", done: true, status: 200 }],
};
const response = (value: SessionRoute | null = route, session = agent.sessionId) =>
  Response.json({ session, seq: 11, route: value });
const signal = () => new AbortController().signal;

for (const provider of ["codex", "claude"]) {
  test(`${provider}: resolves the target native session without guessing from requested model`, async () => {
    let resolutions = 0;
    const read = createRouteReader({
      resolve: async (target) => {
        assert.deepEqual(target, input);
        resolutions++;
        return { ...agent, provider };
      },
      config: async () => config,
      request: async (url, options) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.pathname, "/proxy/v1/magpie/route");
        assert.equal(parsed.searchParams.get("session"), "native-session-A");
        assert.equal(parsed.searchParams.has("after"), false);
        assert.equal(options?.redirect, "error");
        assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${config.apiKey}`);
        return response();
      },
    });
    const result = await read(input, signal());
    assert.equal(result.state.state, "ready");
    assert.equal(result.state.message, "当前会话最近一次请求");
    assert.equal(result.state.route?.model, "test-vendor/actual-model");
    assert.equal(result.seq, 11);
    assert.equal(resolutions, 2);
    assert.equal(routeStateSchema.safeParse(result.state).success, true);
    assert.equal(JSON.stringify(result.state).includes("native-session-A"), false);
  });
}

test("an active route is described as the current request", async () => {
  const activeRoute = { ...route, done: false, tries: [{ ...route.tries[0], done: false }] };
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async () => response(activeRoute),
  });
  const result = await read(input, signal());
  assert.equal(result.state.message, "本次请求");
  assert.equal(result.state.route?.done, false);
});

test("missing, archived, unsupported and foreign-workspace agents never query Magpie", async () => {
  for (const [value, expected] of [
    [null, "unavailable"],
    [{ ...agent, workspaceId: "other-workspace" }, "unavailable"],
    [{ ...agent, archived: true }, "unavailable"],
    [{ ...agent, provider: "opencode" }, "unsupported"],
    [{ ...agent, sessionId: null }, "waiting_session"],
    [{ ...agent, sessionId: " " }, "waiting_session"],
    [{ ...agent, sessionId: "a".repeat(129) }, "waiting_session"],
  ] as const) {
    const read = createRouteReader({
      resolve: async () => value,
      config: async () => { throw new Error("must not read config"); },
      request: async () => { throw new Error("must not query gateway"); },
    });
    assert.equal((await read(input, signal())).state.state, expected);
  }
});

test("a sessionless route stays unknown; requested models do not invent an actual model", async () => {
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async () => response(null),
  });
  const result = await read(input, signal());
  assert.equal(result.state.state, "waiting_route");
  assert.equal(result.state.route, null);
  assert.match(result.state.message, /近期路由/);
});

test("rejects a route response for a different native session", async () => {
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async () => response(route, "different-native-session"),
  });
  await assert.rejects(read(input, signal()), /会话不匹配/);
});

test("session replacement, workspace move and provider change discard an in-flight response", async () => {
  for (const changed of [
    { ...agent, sessionId: "native-session-B" },
    { ...agent, workspaceId: "another-workspace" },
    { ...agent, provider: "claude" },
    { ...agent, archived: true },
    null,
  ]) {
    let current: RouteAgent | null = agent;
    const read = createRouteReader({
      resolve: async () => current, config: async () => config,
      request: async () => { current = changed; return response(); },
    });
    const result = await read(input, signal());
    assert.notEqual(result.state.state, "ready");
    assert.equal(result.state.route, null);
    assert.equal(result.seq, undefined);
  }
});

test("long polling uses a cursor only for its own native session and a sufficient timeout", async () => {
  for (const session of ["native-session-A", "previous-native-session"]) {
    const read = createRouteReader({
      resolve: async () => agent, config: async () => ({ ...config, timeoutMs: 5_000 }),
      request: async (url) => {
        const query = new URL(String(url)).searchParams;
        assert.equal(query.get("after"), session === agent.sessionId ? "11" : null);
        assert.equal(query.get("wait"), session === agent.sessionId ? "2" : null);
        return response();
      },
    });
    await read(input, signal(), { session, seq: 11 });
  }
});

test("preserves auxiliary request kind, fallbacks and missing telemetry without inventing values", async () => {
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async () => response({
      ...route, kind: "title", effort: "high", tier_served: "priority",
      tries: [
        { model: "first/model", done: true, status: 429, fail: "rate limit for account@example.test" },
        ...route.tries,
      ],
    }),
  });
  const result = (await read(input, signal())).state.route!;
  assert.equal(result.kind, "title");
  assert.equal(result.tries.length, 2);
  assert.equal(result.tries[0].status, 429);
  assert.equal(result.effort, "high");
  assert.equal(result.tier_served, "priority");
  assert.equal(result.ms, undefined);
  assert.equal(result.ttft_ms, undefined);
  assert.equal(JSON.stringify(result).includes("account@example.test"), false);
});

test("gateway HTTP, malformed JSON and schema errors never expose bodies or credentials", async () => {
  for (const [reply, message] of [
    [new Response("test-gateway-key private@example.test", { status: 403 }), /403/],
    [new Response("test-gateway-key", { status: 404 }), /升级/],
    [new Response("test-gateway-key"), /无效/],
    [Response.json({ session: agent.sessionId, route, seq: "bad" }), /格式不兼容/],
  ] as const) {
    const read = createRouteReader({
      resolve: async () => agent, config: async () => config, request: async () => reply,
    });
    await assert.rejects(read(input, signal()), (error: Error) => {
      assert.match(error.message, message);
      assert.equal(error.message.includes("test-gateway-key"), false);
      assert.equal(error.message.includes("@"), false);
      return true;
    });
  }
});

test("redacts model fields and suppresses raw upstream failure text", async () => {
  const read = createRouteReader({
    resolve: async () => agent, config: async () => config,
    request: async () => response({
      ...route, model: config.apiKey, served: "Bearer private-token", group: config.apiKey,
      error: "private@example.test test-gateway-key",
      tries: [{ model: "Bearer private-token", done: true, fail: "private@example.test" }],
    }),
  });
  const output = JSON.stringify((await read(input, signal())).state);
  assert.equal(output.includes(config.apiKey), false);
  assert.equal(output.includes("private-token"), false);
  assert.equal(output.includes("private@example.test"), false);
});

test("times out a slow gateway and aborts the request when its subscriber leaves", async () => {
  for (const cancel of [false, true]) {
    const lifetime = new AbortController();
    let requestAborted = false;
    const read = createRouteReader({
      resolve: async () => agent, config: async () => ({ ...config, timeoutMs: 20 }),
      request: async (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          requestAborted = true;
          reject(new Error("sensitive network details"));
        }, { once: true });
        if (cancel) lifetime.abort();
      }),
    });
    await assert.rejects(read(input, lifetime.signal), cancel ? /取消/ : /超时/);
    assert.equal(requestAborted, true);
  }
});

test("watcher clears stale data on failures, recovers and owns its cancellation", async () => {
  const lifetime = new AbortController();
  const states: RouteState[] = [];
  let calls = 0;
  const watch = createRouteWatcher({
    resolve: async () => agent, config: async () => config,
    request: async () => {
      if (++calls === 2) throw new TypeError("private network key");
      return response();
    },
    pause: async () => {},
  });
  await watch(input, {
    signal: lifetime.signal,
    push: async (state) => {
      states.push(state);
      if (states.length === 3) lifetime.abort();
    },
  });
  assert.deepEqual(states.map((state) => state.state), ["ready", "error", "ready"]);
  assert.equal(states[1].route, null);
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(states).includes("private network key"), false);
});

test("cancelling an in-flight watch publishes no late event", async () => {
  const lifetime = new AbortController();
  let pushed = false;
  const watch = createRouteWatcher({
    resolve: async () => agent, config: async () => config,
    request: async () => { lifetime.abort(); return response(); },
  });
  await watch(input, { signal: lifetime.signal, push: async () => { pushed = true; } });
  assert.equal(pushed, false);
});

test("unchanged snapshots are not republished and an evicted trace clears the route", async () => {
  const lifetime = new AbortController();
  const states: RouteState[] = [];
  let calls = 0;
  const watch = createRouteWatcher({
    resolve: async () => agent, config: async () => config,
    request: async () => response(++calls > 2 ? null : route),
    pause: async () => {},
  });
  await watch(input, {
    signal: lifetime.signal,
    push: async (state) => {
      states.push(state);
      if (states.length === 2) lifetime.abort();
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(states.map((state) => state.state), ["ready", "waiting_route"]);
  assert.equal(states[1].route, null);
});
