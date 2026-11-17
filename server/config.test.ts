import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeUrl, readConfig } from "./config.ts";

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
