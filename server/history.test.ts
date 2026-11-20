import assert from "node:assert/strict";
import { test } from "node:test";
import { getHistory } from "../shared/history.ts";
import { createHistoryReader, projectHistory } from "./history.ts";

const base = {
  agent: "codex", t: "2026-11-20T11:15:56.123456+08:00", provider: "codex", providerName: "Codex",
  model: "alias", served: "served-model", status: 200, ttft_ms: 8_700, ms: 12_000, out: 600,
};

test("keeps gateway timing and separates measured speed, lower bounds and unavailable speed", async () => {
  const result = await projectHistory({ offset: 30, total: 87, rows: [
    base,
    { ...base, out: 1_200, reasoning: 600, first_text_ms: 9_000 },
    { ...base, out: 1_200, reasoning: 600, reasoning_hidden: true },
    { ...base, out: 600, flow_ms: 300 },
    { ...base, out: 1_200, flow_ms: 300 },
    { ...base, out: 1_200, err: "private upstream error" },
    { ...base, source: "log" },
  ] });

  assert.equal(result.state, "ready");
  assert.equal(result.offset, 30);
  assert.deepEqual(result.rows.map((row) => row.speed && [Math.round(row.speed.tps), row.speed.lowerBound]), [
    [182, false], [200, false], [182, true], undefined, [100, true], undefined,
  ]);
  assert.equal(result.rows[5].outcome, "failed");
  assert.deepEqual(result.rows[0], {
    time: Date.parse(base.t), agent: "Codex", provider: "Codex", model: "served-model", outcome: "completed",
    status: 200, outputTokens: 600, ttftMs: 8_700, durationMs: 12_000, speed: { tps: 600_000 / 3_300, lowerBound: false },
  });
});

test("reads one gateway page across agents in ledger order and exposes only allowed fields", async () => {
  const config = async () => ({ url: "https://magpie.example/gateway/", apiKey: "private-key", timeoutMs: 1_000 });
  const read = createHistoryReader(config, async (url, init) => {
    assert.equal(String(url), "https://magpie.example/gateway/v1/magpie/usage/requests?period=7d&via=through&offset=100&limit=100");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-key");
    assert.equal(init?.redirect, "error");
    return Response.json({ offset: 100, total: 106, rows: [
      { ...base, agent: "custom-agent", agentName: " Lab\nAgent ", t: "2026-11-20T11:16:00+08:00", served: "private-key",
        providerAccount: "private-account", session: "private-session", input: "private-prompt" },
      { ...base, agent: "claude", agentName: "  ", providerName: "Same upstream", source: "" },
      { ...base, agent: "opencode", providerName: "Same upstream" },
      { ...base, agent: "private-key", agentName: 42 },
      base,
      { ...base, source: "local" },
    ] });
  });
  const result = await read({ period: "7d", offset: 100, limit: 100 });
  assert.equal(result.state, "ready");
  assert.equal(result.offset, 100);
  assert.equal(result.total, 106);
  assert.deepEqual(result.rows.map((row) => row.agent), ["Lab Agent", "Claude Code", "opencode", "[已隐藏]", "Codex"]);
  assert.deepEqual(result.rows.map((row) => row.time), [Date.parse("2026-11-20T11:16:00+08:00"), ...Array(4).fill(Date.parse(base.t))]);
  assert.equal(result.rows[0].model, "[已隐藏]");
  assert.match(result.rows[0].account ?? "", /^#[a-f0-9]{6}$/);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  const denied = createHistoryReader(config, async () => new Response("private details", { status: 403 }));
  assert.deepEqual(await denied({ period: "today", offset: 0 }), { state: "forbidden" });
});

test("uses period totals across pages and subtracts unknown prompt tokens from the cache denominator", async () => {
  const totals = {
    calls: 180, input: 100, output: 20, cache_read: 70, cache_write: 30,
    cache_unknown: 50, cost: 8.75, unpriced: 4,
  };
  const time = "2025-01-02T13:00:00+08:00";
  const unknownTime = "2025-01-02T14:00:00+08:00";
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const read = createHistoryReader(async () => ({ url: "http://127.0.0.1:3425/", timeoutMs: 1_000 }), async (url) => {
    const query = new URL(String(url)).searchParams;
    assert.equal(query.get("via"), "through");
    return Response.json({
      ...totals, through: totals,
      rows: [base], total: 182, offset: Number(query.get("offset")),
      bucket: "hour",
      series: [
        { ...totals, time, by: { byAgent: "private-dimensions" } },
        { ...totals, time: unknownTime, input: 50, cache_read: 0, cache_write: 0, cache_unknown: 50 },
        { ...totals, time: future },
      ],
    });
  });
  const first = getHistory.output.parse(await read({ period: "today", offset: 0 }));
  const next = getHistory.output.parse(await read({ period: "today", offset: 50, limit: 50 }));
  assert.equal(first.state, "ready");
  assert.equal(next.state, "ready");
  assert.equal(next.total, 182);
  assert.equal(next.offset, 50);
  assert.deepEqual(first.overview, next.overview);
  assert.deepEqual(first.overview?.totals, {
    requests: 180, input: 100, output: 20, cacheRead: 70, cacheWrite: 30,
    tokens: 220, cacheHit: 70 / 150, costUsd: 8.75, unpriced: 4,
  });
  assert.equal(first.overview?.bucket, "hour");
  assert.deepEqual(first.overview?.series.map((point) => [point.time, point.cacheHit]), [[time, 70 / 150], [unknownTime, undefined]]);
  assert.doesNotMatch(JSON.stringify(first), /private-dimensions/);
});

test("preserves the request list when gateway totals are missing or include direct calls", async () => {
  const page = { rows: [base], offset: 0, total: 1 };
  const totals = { calls: 50, input: 500, output: 100, cache_read: 100, cache_write: 0, cost: 1 };
  for (const response of [page, { ...page, ...totals, through: { ...totals, calls: 1 } }]) {
    const result = await projectHistory(response);
    assert.equal(result.state, "ready");
    assert.equal(result.rows.length, 1);
    assert.equal(result.overview, undefined);
  }
});

test("links only unique native sessions on the selected host and reads their current Paseo titles", async () => {
  const body = { offset: 0, total: 7, rows: [
    { ...base, native_session: "native", session: "override", title: "Codex original title" },
    { ...base, agent: "claude", native_session: "native" },
    { ...base, agent: "opencode", native_session: "native" },
    { ...base, session: "archived" },
    { ...base, native_session: "duplicate" },
    { ...base, native_session: "unknown", session: "override" },
    { ...base, session: "other-provider" },
  ] };
  const live = (id: string, sessionId: string, title: string, provider = "codex") => ({
    agent: { id, title, runtimeInfo: { provider, sessionId }, persistence: null },
  });
  let title = "Paseo first title";
  const cursors: (string | undefined)[] = [];
  const list: NonNullable<Parameters<typeof projectHistory>[2]> = async ({ filter, page }) => {
    assert.deepEqual(filter, { includeArchived: true, includeBackground: true });
    cursors.push(page.cursor);
    return page.cursor ? {
      entries: [
        live("first", "native", title),
        live("claude-shared", "native", "Claude shared ID", "claude"),
        { agent: { id: "open", title: "OpenCode title", persistence: { provider: "opencode", sessionId: "native" } } },
        live("another-copy", "duplicate", "Second duplicate"),
        { agent: { id: "old", title: "Archived in Paseo", persistence: { provider: "codex", sessionId: "stored", nativeHandle: "archived" } } },
      ],
      pageInfo: { nextCursor: null },
    } : {
      entries: [
        live("unrelated", "override", "Wrong conversation"),
        live("original-copy", "duplicate", "First duplicate"),
        live("claude", "other-provider", "Claude conversation", "claude"),
      ],
      pageInfo: { nextCursor: "second" },
    };
  };
  const before = await projectHistory(body, undefined, list);
  assert.equal(before.state, "ready");
  assert.equal(before.rows[0].session?.title, title);
  title = "Renamed in Paseo";
  const after = await projectHistory(body, undefined, list);
  assert.equal(after.state, "ready");
  assert.deepEqual(after.rows.map((row) => row.session), [
    { agentId: "first", title }, { agentId: "claude-shared", title: "Claude shared ID" },
    { agentId: "open", title: "OpenCode title" }, { agentId: "old", title: "Archived in Paseo" }, undefined, undefined, undefined,
  ]);
  assert.deepEqual(cursors, [undefined, "second", undefined, "second"]);
  assert.doesNotMatch(JSON.stringify(after), /native|Codex original title|Wrong conversation/);
});

test("a Paseo directory error leaves Claude Code performance history available", async () => {
  const result = await projectHistory({
    offset: 0, total: 1, rows: [{ ...base, agent: "claude", native_session: "private-session" }],
  }, undefined, async () => { throw new Error("private directory details"); });
  assert.equal(result.state, "ready");
  assert.equal(result.rows[0].ttftMs, 8_700);
  assert.equal(result.rows[0].session, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test("projects the Magpie ledger columns with their original usage and cost semantics", async () => {
  const result = await projectHistory({
    offset: 0,
    total: 5,
    accounts: [{ id: "custom-account", name: "Work subscription" }],
    rows: [
      { ...base, req: "auto/alias", providerAccount: "custom-account", access: "subscription",
        ep: "/private/chat/completions → /private/responses", ws: true, in: 452, cache_read: 250_624,
        cache_write: 2_000, cost: 0.0261, priced: true, credits: 0 },
      { ...base, served: undefined, host: "private.example as lily@example.net", in: 0, out: 0,
        cache_read: 100, cache_write: 0, cost: 0, priced: true },
      { ...base, providerAccount: "lily@example.net", in: 44, cache_unknown: true, cost: 6, priced: false, credits: 1.5 },
      { ...base, in: 400, cache_read: 0, cache_write: 100, access: "unknown", ep: "/private/non-model", cost: 4 },
      { ...base, in: 0, cache_read: 0, cache_write: 0, ws: true, cost: -1, priced: true, credits: null },
    ],
  });
  assert.equal(result.state, "ready");
  const [priced, free, unknownCache, miss, emptyPrompt] = result.rows;
  assert.equal(priced.requestedModel, "auto/alias");
  assert.equal(priced.model, "served-model");
  assert.equal(priced.account, "Work subscription");
  assert.equal(priced.access, "subscription");
  assert.deepEqual(priced.protocol, { client: "Chat", upstream: "Responses", websocket: true });
  assert.equal(priced.inputTokens, 452);
  assert.equal(priced.outputTokens, 600);
  assert.equal(priced.cacheHit, 250_624 / (452 + 250_624 + 2_000));
  assert.equal(priced.costUsd, 0.0261);
  assert.equal(priced.credits, 0);
  assert.equal(free.model, "");
  assert.equal(free.requestedModel, undefined);
  assert.equal(free.inputTokens, 0);
  assert.equal(free.outputTokens, 0);
  assert.equal(free.cacheHit, 1);
  assert.equal(free.costUsd, 0);
  assert.match(free.account ?? "", /^li•• #[a-f0-9]{6}$/);
  assert.equal(unknownCache.account, free.account);
  assert.equal(unknownCache.cacheHit, undefined);
  assert.equal(unknownCache.costUsd, undefined);
  assert.equal(unknownCache.credits, 1.5);
  assert.equal(miss.cacheHit, 0);
  assert.equal(miss.costUsd, undefined);
  assert.equal(miss.access, undefined);
  assert.equal(miss.protocol, undefined);
  assert.equal(emptyPrompt.cacheHit, undefined);
  assert.equal(emptyPrompt.costUsd, undefined);
  assert.equal(emptyPrompt.protocol, undefined);
  assert.doesNotMatch(JSON.stringify(result), /custom-account|example|\/private/);
});
