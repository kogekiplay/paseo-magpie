import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCodexReplyRoute } from "./codex-reply-route.ts";

test("reads only the matching, private, current v1 bridge record", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-magpie-bridge-test-"));
  try {
    const index = join(root, "magpie", "paseo-bridge", "v1");
    await mkdir(index, { recursive: true });
    const key = createHash("sha256").update("session\0msg_final").digest("hex");
    const path = join(index, `${key}.json`);
    const summary = {
      provider: "first", model: "sol",
      attempts: [{ route: "first/sol", status: 200, failed: false }],
    };
    const signal = new AbortController().signal;

    await writeFile(path, JSON.stringify({ ...summary, version: 2 }), { mode: 0o600 });
    assert.equal(await readCodexReplyRoute("session", "msg_final", signal, root), null);
    await writeFile(path, JSON.stringify({ ...summary, version: 1, private: "discarded" }));
    assert.deepEqual(await readCodexReplyRoute("session", "msg_final", signal, root), summary);
    assert.equal(await readCodexReplyRoute("session", "msg_tool", signal, root), null);
    assert.equal(await readCodexReplyRoute("other", "msg_final", signal, root), null);

    await chmod(path, 0o644);
    assert.equal(await readCodexReplyRoute("session", "msg_final", signal, root), null);
    await chmod(path, 0o600);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    await utimes(path, old, old);
    assert.equal(await readCodexReplyRoute("session", "msg_final", signal, root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
