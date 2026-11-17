import assert from "node:assert/strict";
import { test } from "node:test";
import { createMagpieUsageSource } from "./source.ts";

const config = { url: "http://127.0.0.1:3425/", timeoutMs: 100, apiKey: "sample-secret" };
const rows = [
  { provider: "codex", name: "Codex", kind: "subscription", user: "one@example.test", windows: [{ name: "5h", used: 25 }] },
  { provider: "codex", name: "Codex", kind: "subscription", user: "two@example.test", windows: [{ name: "5h", used: 50 }] },
];
const response = (data: unknown = rows) => Response.json({ object: "list", data });

test("global discovery and concurrent fetches share one request without exposing credentials", async () => {
  let requests = 0;
  const source = createMagpieUsageSource({
    config: async () => config,
    request: async (input, init) => {
      requests++;
      assert.equal(String(input), "http://127.0.0.1:3425/v1/magpie/quotas");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sample-secret");
      assert.equal(init?.redirect, "error");
      return response();
    },
  });
  const accounts = await source.discover({ kind: "global" });
  assert.equal(accounts.length, 2);
  assert.equal(JSON.stringify(accounts).includes("sample-secret"), false);
  assert.equal(JSON.stringify(accounts.map((a) => a.input)).includes("@"), false);
  const reports = await Promise.all(accounts.map((account) => source.fetch(account.input)));
  assert.ok(reports.every((report) => report.status === "available"));
  assert.equal(requests, 1);
});

test("session discovery never reads configuration or returns global accounts", async () => {
  const source = createMagpieUsageSource({
    config: async () => { throw new Error("must not read global configuration"); },
  });
  assert.deepEqual(await source.discover({
    kind: "session", provider: "codex", model: "auto/model", env: {},
  }), []);
});

test("offline gateways retain an error card, recover, and do not cache failures", async () => {
  let online = false;
  const source = createMagpieUsageSource({
    config: async () => config,
    request: async () => {
      if (!online) throw new TypeError("fetch failed: sample-secret");
      return response();
    },
  });
  const offline = await source.discover({ kind: "global" });
  assert.equal(offline.length, 1);
  const error = await source.fetch(offline[0].input);
  assert.equal(error.status, "error");
  assert.equal(JSON.stringify(error).includes("sample-secret"), false);
  online = true;
  assert.equal((await source.discover({ kind: "global" })).length, 2);
});

test("empty gateways and account removal stay unavailable instead of showing zero", async () => {
  let currentRows = rows;
  let now = 0;
  const source = createMagpieUsageSource({
    config: async () => config,
    now: () => now,
    request: async () => response(currentRows),
  });
  const accounts = await source.discover({ kind: "global" });
  currentRows = [];
  now = 2_000;
  const removed = await source.fetch(accounts[0].input);
  assert.equal(removed.status, "unavailable");
  const gateway = await source.discover({ kind: "global" });
  assert.equal(gateway.length, 1);
  assert.equal((await source.fetch(gateway[0].input)).status, "unavailable");
});

test("configuration changes invalidate batches and cannot silently replace a selected account", async () => {
  let url = config.url;
  let requests = 0;
  const source = createMagpieUsageSource({
    config: async () => ({ ...config, url }),
    request: async () => { requests++; return response(); },
  });
  const accounts = await source.discover({ kind: "global" });
  url = "https://other.example.test/";
  assert.equal((await source.fetch(accounts[0].input)).status, "unavailable");
  assert.equal(requests, 2);
});

test("rejects invalid response data and does not reveal upstream error bodies", async () => {
  const source = createMagpieUsageSource({
    config: async () => config,
    request: async () => new Response("sample-secret", { status: 403 }),
  });
  const [account] = await source.discover({ kind: "global" });
  const report = await source.fetch(account.input);
  assert.equal(report.status, "error");
  assert.match(JSON.stringify(report), /403/);
  assert.equal(JSON.stringify(report).includes("sample-secret"), false);
  const invalid = createMagpieUsageSource({
    config: async () => config,
    request: async () => Response.json({ data: [{ provider: 123 }] }),
  });
  const [bad] = await invalid.discover({ kind: "global" });
  assert.equal((await invalid.fetch(bad.input)).status, "error");
});

test("redacts configured keys and bearer tokens in account read errors", async () => {
  const source = createMagpieUsageSource({
    config: async () => config,
    request: async () => response([{
      ...rows[0], windows: [], error: "failed sample-secret Bearer another-secret sk-longsecretvalue",
    }]),
  });
  const [account] = await source.discover({ kind: "global" });
  const output = JSON.stringify(await source.fetch(account.input));
  assert.equal(output.includes("sample-secret"), false);
  assert.equal(output.includes("another-secret"), false);
  assert.equal(output.includes("sk-longsecretvalue"), false);
});

test("aborts a slow gateway within the plugin deadline", async () => {
  const source = createMagpieUsageSource({
    config: async () => config,
    request: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  const report = await source.fetch({ kind: "gateway" });
  assert.equal(report.status, "error");
  assert.match(JSON.stringify(report), /超时/);
});
