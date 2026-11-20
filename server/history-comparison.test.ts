import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistoryComparison } from "./history-comparison.ts";
import { getComparison, getHistory, getTrend } from "../shared/history.ts";

const config = { url: "http://127.0.0.1:3425/", timeoutMs: 1000 };
const base = {
  t: "2026-11-20T11:15:56+08:00", agent: "codex", model: "upstream-alias", req: "auto/alias",
  served: "actual-model", provider: "vendor-a", providerName: "Vendor A", status: 200, out: 400,
};

function respond(rows: unknown[], offset: number, limit: number) {
  return Response.json({ rows: rows.slice(offset, offset + limit), total: rows.length, offset });
}

test("compares actual routes and drills down into the same rows without using speed lower bounds", async () => {
  const rows = [
    { ...base, ttft_ms: 1000, ms: 3000, native_session: "private-session", providerAccount: "example@example.org" },
    { ...base, ttft_ms: 3000, ms: 7000 },
    { ...base, ttft_ms: 5000, ms: 10000, out: 2000, flow_ms: 100 },
    { ...base, ttft_ms: 20000, ms: 24000, status: 502 },
    { ...base, ttft_ms: 18000, ms: 21000, canceled: true },
    { ...base, ttft_ms: 200, ms: 700, handed_on: true },
    { ...base, ttft_ms: 500, ms: 1500, source: "log" },
    { ...base, provider: "vendor-b", providerName: "Vendor B", ttft_ms: 6000, ms: 7000, agent: "claude" },
    { ...base, provider: "vendor-c", providerName: "Vendor B" },
    { ...base, served: "different-model", ttft_ms: 300, ms: 1800 },
    { ...base, served: undefined, ttft_ms: 700, ms: 2500 },
  ];
  let calls = 0;
  const service = createHistoryComparison(async () => config, async (input) => {
    const query = new URL(String(input)).searchParams;
    assert.equal(query.get("via"), "through");
    assert.equal(query.get("period"), "7d");
    assert.equal(query.get("model"), null);
    assert.equal(query.get("agent"), null);
    calls++;
    return respond(rows, Number(query.get("offset")), Number(query.get("limit")));
  });
  const output = getComparison.output.parse(await service.compare({ period: "7d" }));
  assert.equal(output.state, "ready");
  const [model, different] = output.models;
  assert.equal(model.name, "actual-model");
  assert.equal(different.name, "different-model");
  const [a, b, c] = model.providers;
  assert.deepEqual(a, { id: a.id, name: "Vendor A", requests: 5, ttft: { p50: 3000, p90: 5000, count: 3 }, speed: { p50: 150, count: 2 } });
  assert.equal(b.requests, 1);
  assert.equal(c.ttft, undefined);
  assert.equal(c.speed, undefined);
  assert.notEqual(b.id, c.id);
  const page = getHistory.output.parse(await service.details({ period: "7d", route: a.id, offset: 0 }, async () => ({
    entries: [{ agent: { id: "paseo-id", title: "Renamed in Paseo", persistence: { provider: "codex", sessionId: "private-session" } } }],
    pageInfo: { nextCursor: null },
  })));
  assert.equal(page.state, "ready");
  assert.equal(page.total, a.requests);
  assert.deepEqual(page.rows.map((row) => row.outcome), ["completed", "completed", "completed", "failed", "canceled"]);
  assert.deepEqual(page.rows[0].session, { agentId: "paseo-id", title: "Renamed in Paseo" });
  assert.equal(page.rows[2].speed?.lowerBound, true);
  assert.doesNotMatch(JSON.stringify({ output, page }), /private-session|example@example.org|vendor-a/);
  assert.equal(calls, 1, "drilldown reuses the snapshot");
});

test("continues at the last row when new requests shift offsets and refreshes only on request", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    ...base, rid: `fixture-${i}`, ttft_ms: i + 1,
  }));
  let calls = 0;
  const offsets: number[] = [];
  const service = createHistoryComparison(async () => config, async (input) => {
    const query = new URL(String(input)).searchParams;
    const offset = Number(query.get("offset"));
    offsets.push(offset);
    calls++;
    if (calls === 2) rows.unshift({ ...base, rid: "new", ttft_ms: 9999 });
    return respond(rows, offset, Number(query.get("limit")));
  });
  const [snapshot, shared] = await Promise.all([service.compare({ period: "today" }), service.compare({ period: "today" })]);
  assert.equal(snapshot.state, "ready");
  assert.deepEqual(shared, snapshot);
  const group = snapshot.models[0].providers[0];
  assert.deepEqual(group.ttft, { p50: 300.5, p90: 540, count: 600 });
  const details = await service.details({ period: "today", route: group.id, offset: 490 });
  assert.equal(details.state, "ready");
  assert.equal(details.total, 600);
  assert.deepEqual(details.rows.map((row) => row.ttftMs), Array.from({ length: 30 }, (_, i) => i + 491));
  assert.deepEqual(offsets, [0, 484]);
  const refreshed = await service.compare({ period: "today", refresh: true });
  assert.equal(refreshed.state, "ready");
  assert.equal(refreshed.models[0].providers[0].requests, 601);
  assert.deepEqual(offsets, [0, 484, 0, 484]);
});

test("does not reuse another gateway key's snapshot and rejects a missing page boundary", async () => {
  let apiKey = "first";
  let loseTail = true;
  const rows = Array.from({ length: 501 }, (_, i) => ({ ...base, rid: `fixture-${i}` }));
  const service = createHistoryComparison(async () => ({ ...config, apiKey }), async (input, init) => {
    if (new Headers(init?.headers).get("Authorization") === "Bearer second") {
      return new Response("", { status: 403 });
    }
    const query = new URL(String(input)).searchParams;
    const offset = Number(query.get("offset"));
    const inputRows = offset && loseTail ? rows.filter((row) => row.rid !== "fixture-499") : rows;
    return respond(inputRows, offset, Number(query.get("limit")));
  });
  assert.deepEqual(await service.compare({ period: "7d" }), { state: "unavailable" });
  loseTail = false;
  const result = await service.compare({ period: "7d" });
  assert.equal(result.state, "ready");
  apiKey = "second";
  assert.deepEqual(await service.compare({ period: "7d" }), { state: "forbidden" });
  assert.deepEqual(await service.details({ period: "7d", offset: 0, route: result.models[0].providers[0].id }), { state: "forbidden" });
});

test("computes trends by provider and day, and paginates the exact bucket with Paseo session links", async () => {
  const day = (n: number) => new Date(2026, 10, n).getTime();
  const rows = [
    { ...base, t: new Date(day(20)).toISOString(), ttft_ms: 1_000, ms: 3_000 },
    { ...base, t: new Date(day(19)).toISOString(), served: "different-model", ttft_ms: 500, ms: 1_500 },
    ...Array.from({ length: 31 }, (_, i) => ({
      ...base, t: new Date(day(19) - i - 1).toISOString(),
      ttft_ms: i === 0 ? 5_000 : 1_000, ms: i === 0 ? 6_000 : 3_000,
      native_session: "private-session",
    })),
    { ...base, t: new Date(day(18)).toISOString(), ttft_ms: 7_000, ms: 10_000, status: 502 },
    { ...base, t: new Date(day(18)).toISOString(), ttft_ms: 9_000, ms: 10_000, handed_on: true },
    { ...base, t: new Date(day(18)).toISOString(), ttft_ms: 3_000, ms: 9_000, out: 2_000, flow_ms: 100 },
    { ...base, t: new Date(day(18)).toISOString(), provider: "vendor-b", providerName: "Vendor B", ttft_ms: 7_000, ms: 11_000 },
    { ...base, t: new Date(day(16)).toISOString(), provider: "vendor-b", providerName: "Vendor B" },
  ];
  let calls = 0;
  const service = createHistoryComparison(async () => config, async () => {
    calls++;
    return respond(rows, 0, 500);
  });
  const compared = await service.compare({ period: "7d" });
  assert.equal(compared.state, "ready");
  const [model] = compared.models;
  const output = getTrend.output.parse(await service.trend({ period: "7d", model: model.id }));
  assert.equal(output.state, "ready");
  assert.deepEqual(output.buckets.map(({ start }) => start), [day(16), day(17), day(18), day(19), day(20)]);
  const [a, b] = output.providers;
  assert.deepEqual(a.points.find((point) => point.start === day(18)), {
    start: day(18), requests: 33,
    p90: { value: 1_000, count: 32 }, tpsP50: { value: 200, count: 31 },
  });
  assert.equal(a.points.some((point) => point.start === day(19)), false, "actual model stays isolated");
  assert.deepEqual(b.points.find((point) => point.start === day(18))?.p90, { value: 7_000, count: 1 });
  assert.equal(b.points.find((point) => point.start === day(16))?.p90, undefined);
  const drilldown = { period: "7d", route: a.id, bucket: day(18), snapshot: output.snapshot, offset: 30 } as const;
  const page = await service.details(drilldown, async () => ({
    entries: [{ agent: { id: "paseo-id", title: "Renamed in Paseo", persistence: { provider: "codex", sessionId: "private-session" } } }],
    pageInfo: { nextCursor: null },
  }));
  assert.equal(page.state, "ready");
  assert.equal(page.total, 33);
  assert.equal(page.rows.length, 3);
  assert.deepEqual(page.rows[0].session, { agentId: "paseo-id", title: "Renamed in Paseo" });
  assert.doesNotMatch(JSON.stringify(output), /private-session|vendor-a/);
  assert.equal(calls, 1);
  await service.compare({ period: "7d", refresh: true });
  assert.deepEqual(await service.details(drilldown), { state: "expired" });
  assert.equal(calls, 2);
});

test("today's trend uses half-open hourly buckets", async () => {
  const start = new Date(2026, 10, 20, 10).getTime();
  const rows = [start + 3_600_000, start + 3_599_999].map((time) => ({
    ...base, t: new Date(time).toISOString(), ttft_ms: 2_000, ms: 6_000,
  }));
  const service = createHistoryComparison(async () => config, async () => respond(rows, 0, 500));
  const compared = await service.compare({ period: "today" });
  assert.equal(compared.state, "ready");
  const [model] = compared.models;
  const output = await service.trend({ period: "today", model: model.id });
  assert.equal(output.state, "ready");
  assert.deepEqual(output.buckets, [
    { start, end: start + 3_600_000 },
    { start: start + 3_600_000, end: start + 7_200_000 },
  ]);
  const page = await service.details({ period: "today", route: model.providers[0].id, bucket: start, offset: 0 });
  assert.equal(page.state, "ready");
  assert.deepEqual(page.rows.map((row) => row.time), [start + 3_599_999]);
});
