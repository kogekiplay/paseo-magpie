import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGatewayConfiguration } from "./gateway-settings.ts";

test("migrates the saved address and privately saves, scopes, replaces, and removes its key", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-magpie-gateway-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const legacy = { read: async () => ({ status: "ready" as const, revision: "previous", values: { url: "https://remote.test/api/v1" } }) };
  const env = { PASEO_HOME: home, PASEO_MAGPIE_CONFIG: join(home, "config.json") };
  const gateway = createGatewayConfiguration(legacy, env);
  const before = await gateway.read();
  assert.equal(before.url, "https://remote.test/api/v1");
  const key = "fixture-gateway-key";
  const saved = await gateway.save({ url: before.url, revision: before.revision, apiKey: key });
  assert.equal(saved.status, "saved");
  assert.equal(JSON.stringify(saved).includes(key), false);

  const reloaded = createGatewayConfiguration(legacy, env);
  assert.equal((await reloaded.read()).keySource, "saved");
  assert.equal((await reloaded.config()).apiKey, key);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(home, "paseo-magpie", "gateway.json"))).mode & 0o777, 0o600);
  }

  const { revision } = await reloaded.read();
  const [changed, stale] = await Promise.all([
    reloaded.save({ url: "https://remote.test/other", revision }),
    reloaded.save({ url: before.url, revision, apiKey: "stale-key" }),
  ]);
  assert.equal(changed.status, "saved");
  assert.equal(stale.status, "conflict");
  assert.equal((await reloaded.config()).apiKey, undefined);
  await reloaded.save({ url: before.url, revision: (await reloaded.read()).revision });
  assert.equal((await reloaded.config()).apiKey, key);

  const nextKey = "rotated-fixture-key";
  await reloaded.save({ url: before.url, revision: (await reloaded.read()).revision, apiKey: nextKey });
  assert.equal((await reloaded.config()).apiKey, nextKey);
  await reloaded.save({ url: before.url, revision: (await reloaded.read()).revision, apiKey: null });
  assert.equal((await reloaded.config()).apiKey, undefined);
  assert.equal((await reloaded.read()).hasSavedKey, false);
});

test("retains file configuration and honors an environment-managed key for its gateway", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-magpie-gateway-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const legacy = { read: async () => ({ status: "ready" as const, revision: "missing", values: { url: "" } }) };
  const file = join(home, "config.json");
  await writeFile(file, JSON.stringify({ url: "https://remote.test", apiKey: "file-key" }));
  const env = { PASEO_HOME: home, PASEO_MAGPIE_CONFIG: file };
  const gateway = createGatewayConfiguration(legacy, env);
  assert.equal((await gateway.read()).keySource, "host");
  await gateway.save({ url: "", revision: (await gateway.read()).revision, apiKey: "replacement-key" });
  assert.equal((await gateway.config()).apiKey, "replacement-key");
  const managed = createGatewayConfiguration(legacy, { ...env, PASEO_MAGPIE_API_KEY: "env-key" });
  assert.equal((await managed.read()).keySource, "environment");
  assert.deepEqual(await managed.save({ url: "", revision: (await managed.read()).revision, apiKey: "ignored-key" }), { status: "managed" });
  assert.equal((await managed.config()).apiKey, "env-key");
  await managed.save({ url: "", revision: (await managed.read()).revision, apiKey: null });
  assert.equal((await gateway.config()).apiKey, "file-key");
});
