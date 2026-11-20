import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeUrl, readConfig } from "./config.ts";
import { gatewaySettings } from "../shared/gateway-settings.ts";

test("normalizes gateway URLs and rejects credentials, query strings, and non-HTTP schemes", () => {
  assert.equal(normalizeUrl("http://localhost:3425"), "http://localhost:3425/");
  assert.equal(normalizeUrl("https://example.test/proxy/v1/"), "https://example.test/proxy/");
  for (const value of ["file:///tmp/test", "http://secret@host/", "http://host/?key=secret", "not-a-url"]) {
    assert.throws(() => normalizeUrl(value));
  }
});

test("uses defaults, re-reads settings, and accepts environment overrides without printing file contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-magpie-config-"));
  const path = join(directory, "settings.json");
  const env = { PASEO_MAGPIE_CONFIG: path };
  try {
    assert.deepEqual(await readConfig(env), {
      url: "http://127.0.0.1:3425/", apiKey: undefined, timeoutMs: 15_000,
    });
    await writeFile(path, JSON.stringify({ url: "https://example.test/", apiKey: "local-secret" }));
    assert.equal((await readConfig(env)).apiKey, "local-secret");
    assert.equal((await readConfig({ ...env, PASEO_MAGPIE_URL: "http://localhost:4321" })).url, "http://localhost:4321/");
    await writeFile(path, "{local-secret");
    await assert.rejects(readConfig(env), (error: Error) => !error.message.includes("local-secret"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a saved host address overrides the file without carrying the file's key to another gateway", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-magpie-config-"));
  const path = join(directory, "config.json");
  const env = { PASEO_MAGPIE_CONFIG: path };
  try {
    await writeFile(path, JSON.stringify({ url: "https://magpie.example/old", apiKey: "daemon-only-key", timeoutMs: 5_000 }));
    assert.deepEqual(await readConfig(env, "https://magpie.example/new/v1"), {
      url: "https://magpie.example/new/", apiKey: undefined, timeoutMs: 5_000,
    });
    assert.equal((await readConfig(env, "https://another.example")).apiKey, undefined);
    assert.equal((await readConfig(env, "https://magpie.example/old/v1")).apiKey, "daemon-only-key");
    assert.equal((await readConfig(env, "")).url, "https://magpie.example/old/");
    assert.deepEqual(await readConfig({ ...env, PASEO_MAGPIE_URL: "https://override.example" }, "https://ignored.example"), {
      url: "https://override.example/", apiKey: "daemon-only-key", timeoutMs: 5_000,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates host settings without repeatedly stripping the gateway API suffix", () => {
  assert.deepEqual(gatewaySettings.schema.parse({}), { url: "" });
  const url = "https://magpie.example/proxy/v1/v1/";
  const values = gatewaySettings.schema.parse({ url: ` ${url} ` });
  assert.deepEqual(gatewaySettings.schema.parse(values), { url });
  assert.equal(normalizeUrl(values.url), "https://magpie.example/proxy/v1/");
  for (const url of ["host:3425", "ftp://host", "https://user:password@host", "http://host/?key=example", "http://host/#fragment"]) {
    assert.equal(gatewaySettings.schema.safeParse({ url }).success, false);
  }
  assert.equal(gatewaySettings.schema.safeParse({ url: "", apiKey: "not-a-host-field" }).success, false);
});
