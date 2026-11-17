import assert from "node:assert/strict";
import { test } from "node:test";
import { accountKey, quotaReport, quotaSchema } from "./quota.ts";

const quota = (value: Record<string, unknown> = {}) => quotaSchema.parse({
  provider: "codex", name: "Codex", kind: "subscription", user: "sample@example.test", ...value,
});

test("preserves unknown percentages, real zero, resets, and stable window pins", () => {
  const first = quotaReport(quota({ windows: [
    { name: "Week", resetsAt: "2026-12-01T00:00:00Z" },
    { name: "5h", used: 0, remaining: 100 },
  ] }));
  const second = quotaReport(quota({ windows: [
    { name: "5h", used: 70, remaining: 30 },
    { name: "Week", used: 25, resetsAt: "2026-12-08T00:00:00Z" },
  ] }));
  assert.equal(first.status, "available");
  assert.equal(second.status, "available");
  if (first.status !== "available" || second.status !== "available") return;
  assert.equal(first.windows[0].usedPct, null);
  assert.equal(first.windows[0].remainingPct, null);
  assert.equal(first.windows[1].usedPct, 0);
  assert.equal(first.windows[1].remainingPct, 100);
  assert.equal(first.windows[0].resetsAt, "2026-12-01T00:00:00.000Z");
  assert.equal(first.windows[0].id, second.windows[1].id);
  assert.equal(first.windows[1].id, second.windows[0].id);
});

test("keeps account identity independent of display names and usage", () => {
  const a = quota({ alias: "Before", windows: [{ name: "Week", used: 20 }] });
  const b = quota({ name: "Renamed", alias: "After", windows: [{ name: "Week", used: 80 }] });
  const key = accountKey("http://localhost:3425/", a);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, accountKey("http://localhost:3425/", b));
  assert.notEqual(key, accountKey("http://other:3425/", b));
  assert.notEqual(key, accountKey("http://localhost:3425/", quota({ user: "other@example.test" })));
});

test("keeps model-specific scopes separate even when their period names match", () => {
  const report = quotaReport(quota({ windows: [
    { name: "Week", lane: "Model A", used: 10 },
    { name: "Week", lane: "Model B", used: 90 },
  ] }));
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.notEqual(report.windows[0].id, report.windows[1].id);
});

test("wallet readings never become 100% free windows and unsupported currencies stay textual", () => {
  const report = quotaReport(quota({ windows: [
    { name: "Wallet", used: 0, remaining: 0, balance: 0, unit: "USD" },
    { name: "人民币", used: 0, remaining: 0, balance: 123, unit: "CNY" },
    { name: "Monthly credits", amount: 40, limit: 100, used: 40, unit: "credits" },
  ] }));
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows.length, 1);
  assert.equal(report.balances?.length, 2);
  assert.equal(report.balances?.[0].remaining, 0);
  assert.equal(report.balances?.[0].tone, "danger");
  assert.equal(report.balances?.[1].remaining, 60);
  assert.ok(report.details?.some((item) => item.value === "123 CNY"));
});

test("text-only and unlimited quotas do not invent percentages", () => {
  const report = quotaReport(quota({ windows: [
    { name: "Plan", text: true, used: 0, remaining: 0, display: "按供应商显示" },
    { name: "Unlimited", unlimited: true, used: 0, remaining: 0 },
  ] }));
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.deepEqual(report.windows, []);
  assert.ok(report.details?.some((item) => item.value === "不限额"));
});

test("keeps stale readings visible with their read time and failure", () => {
  const report = quotaReport(quota({
    readAt: "2026-11-17T01:00:00Z",
    error: "供应商暂不可用",
    windows: [{ name: "Week", used: 76 }],
  }));
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows[0].usedPct, 76);
  assert.ok(report.details?.some((item) => item.id === "read-at" && item.value === "2026-11-17T01:00:00.000Z"));
  assert.ok(report.details?.some((item) => item.id === "read-error" && item.tone === "warning"));
  assert.deepEqual(quotaReport(quota({ error: "读取失败" })), { status: "error", error: "读取失败" });
  assert.equal(quotaReport(quota()).status, "unavailable");
});
