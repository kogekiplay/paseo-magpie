import assert from "node:assert/strict";
import { test } from "node:test";
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
    { ...base, agent: "claude" },
  ] }, "codex");

  assert.equal(result.state, "ready");
  assert.equal(result.offset, 30);
  assert.deepEqual(result.rows.map((row) => row.speed && [Math.round(row.speed.tps), row.speed.lowerBound]), [
    [182, false], [200, false], [182, true], undefined, [100, true], undefined,
  ]);
  assert.equal(result.rows[5].outcome, "failed");
  assert.deepEqual(result.rows[0], {
    time: Date.parse(base.t), provider: "Codex", model: "served-model", outcome: "completed",
    status: 200, outputTokens: 600, ttftMs: 8_700, durationMs: 12_000, speed: { tps: 600_000 / 3_300, lowerBound: false },
  });
});

test("reads a scoped page through the configured gateway and exposes only allowed fields", async () => {
  const config = async () => ({ url: "https://magpie.example/gateway/", apiKey: "private-key", timeoutMs: 1_000 });
  const read = createHistoryReader(config, async (url, init) => {
    assert.equal(String(url), "https://magpie.example/gateway/v1/magpie/usage/requests?period=7d&agent=codex&via=through&offset=100&limit=100");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-key");
    assert.equal(init?.redirect, "error");
    return Response.json({ offset: 100, total: 101, rows: [
      { ...base, served: "private-key", providerAccount: "private-account", session: "private-session", input: "private-prompt" },
    ] });
  });
  const result = await read({ period: "7d", agent: "codex", offset: 100, limit: 100 });
  assert.equal(result.state, "ready");
  assert.equal(result.rows[0].model, "[已隐藏]");
  assert.match(result.rows[0].account ?? "", /^#[a-f0-9]{6}$/);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  const denied = createHistoryReader(config, async () => new Response("private details", { status: 403 }));
  assert.deepEqual(await denied({ period: "today", agent: "codex", offset: 0 }), { state: "forbidden" });
});

test("links only unique native sessions on the selected host and reads their current Paseo titles", async () => {
  const body = { offset: 0, total: 5, rows: [
    { ...base, native_session: "native", session: "override", title: "Codex original title" },
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
  const list: NonNullable<Parameters<typeof projectHistory>[3]> = async ({ filter, page }) => {
    assert.deepEqual(filter, { includeArchived: true, includeBackground: true });
    cursors.push(page.cursor);
    return page.cursor ? {
      entries: [
        live("first", "native", title),
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
  const before = await projectHistory(body, "codex", undefined, list);
  assert.equal(before.state, "ready");
  assert.equal(before.rows[0].session?.title, title);
  title = "Renamed in Paseo";
  const after = await projectHistory(body, "codex", undefined, list);
  assert.equal(after.state, "ready");
  assert.deepEqual(after.rows.map((row) => row.session), [
    { agentId: "first", title }, { agentId: "old", title: "Archived in Paseo" }, undefined, undefined, undefined,
  ]);
  assert.deepEqual(cursors, [undefined, "second", undefined, "second"]);
  assert.doesNotMatch(JSON.stringify(after), /native_session|Codex original title|Wrong conversation/);
});

test("a Paseo directory error leaves Claude Code performance history available", async () => {
  const result = await projectHistory({
    offset: 0, total: 1, rows: [{ ...base, agent: "claude", native_session: "private-session" }],
  }, "claude", undefined, async () => { throw new Error("private directory details"); });
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
  }, "codex");
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
