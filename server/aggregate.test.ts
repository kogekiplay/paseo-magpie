import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateReport, quotaGroups } from "./aggregate.ts";
import { quotaSchema } from "./quota.ts";

const now = Date.parse("2026-11-17T06:00:00Z");
const url = "http://localhost:3425/";
const quota = (user: string, value: Record<string, unknown> = {}) => quotaSchema.parse({
  provider: "codex", name: "Codex", kind: "subscription", user, plan: "team", ...value,
});
const team = (user: string, used: number) => quota(user, {
  windows: [
    { name: "5 hours", used: 0 },
    { name: "7 days", used },
  ],
});

test("matches the mixed-plan example: two Team accounts leave 38%, Pro Lite stays separate", () => {
  const group = quotaGroups(url, [
    team("a", 26), team("b", 98),
    quota("c", { plan: "prolite", windows: [{ name: "7 days", used: 82 }] }),
  ])[0];
  const report = aggregateReport(group, now);
  assert.equal(group.members.length, 3);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows.length, 2);
  assert.equal(report.windows.find((window) => window.label.startsWith("5 小时"))?.remainingPct, 100);
  assert.equal(report.windows.find((window) => window.label.startsWith("7 天"))?.remainingPct, 38);
  assert.ok(report.windows.every((window) => !window.label.includes("Team")));
  assert.ok(!report.details?.some((detail) => detail.label.includes("Team")));
  assert.deepEqual(report.windows.map((window) => window.shortLabel), ["5 小时", "7 天"]);
  assert.ok(!report.details?.some((detail) => ["scope", "method", "reset-note"].includes(detail.id) || detail.id.endsWith("-scope")));
});

test("group keys and pinned windows survive reorder, renamed accounts and membership changes", () => {
  const a = team("a", 20);
  const b = team("b", 80);
  const first = quotaGroups(url, [a, b])[0];
  const second = quotaGroups(url, [b, { ...a, alias: "Renamed" }, team("c", 50)])[0];
  assert.equal(first.key, second.key);
  const left = aggregateReport(first, now);
  const right = aggregateReport(second, now);
  assert.equal(left.status, "available");
  assert.equal(right.status, "available");
  if (left.status !== "available" || right.status !== "available") return;
  assert.deepEqual(left.windows.map((window) => window.id), right.windows.map((window) => window.id));
  assert.notEqual(first.key, quotaGroups("https://other.example.test/", [a, b])[0].key);
});

test("never combines different providers, origins or store kinds and counts duplicate accounts once", () => {
  const a = team("a", 20);
  const b = team("b", 80);
  const groups = quotaGroups(url, [
    a, a, b,
    { ...a, provider: "claude" },
    { ...a, kind: "plan" },
    { ...a, from: "Other host" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
});

test("skips failed and unknown readings rather than treating them as a full or empty allowance", () => {
  const report = aggregateReport(quotaGroups(url, [
    team("a", 20), team("b", 60),
    quota("c", { error: "Failed", windows: [{ name: "7 days", used: 100 }] }),
    quota("d", { windows: [{ name: "7 days" }] }),
  ])[0], now);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows.find((window) => window.label.startsWith("7 天"))?.remainingPct, 60);
  assert.ok(report.details?.some((detail) => detail.id === "unread" && detail.value.includes("1 个账号")));
});

test("expired fallback readings are excluded and aggregate reset means the first account renewal", () => {
  const report = aggregateReport(quotaGroups(url, [
    quota("a", { windows: [{ name: "7 days", used: 20, resetsAt: "2026-11-18T00:00:00Z" }] }),
    quota("b", { windows: [{ name: "7 days", used: 60, resetsAt: "2026-11-19T00:00:00Z" }] }),
    quota("c", { asOf: "2026-11-16T00:00:00Z", windows: [{ name: "7 days", used: 100, resetsAt: "2026-11-17T00:00:00Z" }] }),
  ])[0], now);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows[0].remainingPct, 60);
  assert.equal(report.windows[0].resetsAt, "2026-11-18T00:00:00.000Z");
});

test("counted quotas use summed capacity instead of averaging unlike plans", () => {
  const report = aggregateReport(quotaGroups(url, [
    quota("a", { plan: "small", windows: [{ name: "Monthly", used: 50, amount: 50, limit: 100, unit: "credits" }] }),
    quota("b", { plan: "large", windows: [{ name: "Monthly", used: 10, amount: 100, limit: 1000, unit: "credits" }] }),
  ])[0], now);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.balances?.[0].used, 150);
  assert.equal(report.balances?.[0].limit, 1100);
  assert.equal(report.balances?.[0].remaining, 950);
  assert.ok(Math.abs(report.windows[0].usedPct! - 100 * 150 / 1100) < 1e-9);
});

test("wallets add only compatible units and never double-count shared balances", () => {
  const report = aggregateReport(quotaGroups(url, [
    quota("a", { windows: [{ name: "Wallet", balance: 5, unit: "USD" }] }),
    quota("b", { windows: [{ name: "Wallet", balance: 8, unit: "USD" }] }),
    quota("c", { windows: [{ name: "Wallet", balance: 500, unit: "CNY" }] }),
  ])[0], now);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.balances?.length, 1);
  assert.equal(report.balances?.[0].remaining, 13);
  assert.deepEqual(report.windows, []);
  assert.equal(aggregateReport(quotaGroups(url, [
    quota("a", { windows: [{ name: "Wallet", balance: 5, unit: "USD" }] }),
    quota("b", { sharedBalance: "shared", windows: [{ name: "Wallet", balance: 5, unit: "USD" }] }),
  ])[0], now).status, "unavailable");
});

test("only jointly reported unlimited windows are considered unlimited", () => {
  const a = quota("a", { windows: [{ name: "Unlimited", unlimited: true }] });
  const b = quota("b", { windows: [{ name: "Unlimited", unlimited: true }] });
  assert.equal(aggregateReport(quotaGroups(url, [a, b])[0], now).status, "available");
  assert.equal(aggregateReport(quotaGroups(url, [a, b, team("c", 50)])[0], now).status, "unavailable");
});

test("an explicitly held window contributes none left and its identity is still stable", () => {
  const report = aggregateReport(quotaGroups(url, [
    quota("a", { windows: [{ name: "5 hours", used: 0, heldBy: "7 days" }] }),
    quota("b", { windows: [{ name: "5 hours", used: 0 }] }),
  ])[0], now);
  assert.equal(report.status, "available");
  if (report.status !== "available") return;
  assert.equal(report.windows[0].remainingPct, 50);
});

test("single-account or incompatible windows do not invent a pooled percentage", () => {
  assert.deepEqual(quotaGroups(url, [team("a", 20)]), []);
  const report = aggregateReport(quotaGroups(url, [
    team("a", 20),
    quota("b", { plan: "pro", windows: [{ name: "7 days", used: 80 }] }),
  ])[0], now);
  assert.equal(report.status, "unavailable");
});
