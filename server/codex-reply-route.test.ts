import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCodexReplyRoute, readCodexTurnRoutes } from "./codex-reply-route.ts";

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

test("orders exact native-turn requests before the reply and ignores other or unsafe records", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-magpie-history-test-"));
  try {
    const index = join(root, "magpie", "paseo-bridge", "v1");
    await mkdir(index, { recursive: true, mode: 0o700 });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const turn = hash("session\0exact-turn");
    const request = hash("final-response");
    const summary = (provider: string) => ({ provider, model: "sol", attempts: [{ route: `${provider}/sol`, status: 200, failed: false }] });
    const order = (id: number) => ({ id, time: 1000 });
    const write = (key: string, value: unknown, mode = 0o600) => writeFile(join(index, `${key}.json`), JSON.stringify(value), { mode });
    const record = (provider: string, id: number, phase = "tool") => ({ version: 1, ...summary(provider), order: order(id), phase });
    await Promise.all([
      write(hash("session\0msg_final"), { version: 1, ...summary("last"), history: { turn, request, order: order(4) } }),
      write(`${turn}-${hash("second")}`, record("second", 2)),
      write(`${turn}-${hash("first")}`, record("first", 1)),
      write(`${turn}-${request}`, record("last", 4, "reply")),
      write(`${turn}-${hash("later")}`, record("later", 5)),
      write(`${hash("session\0different-turn")}-${hash("other")}`, record("other-turn", 1)),
      write(`${turn}-${hash("public")}`, record("public", 3), 0o644),
    ]);
    assert.deepEqual(await readCodexReplyRoute("session", "msg_final", new AbortController().signal, root), {
      ...summary("last"), requests: [
        { ...summary("first"), phase: "tool" }, { ...summary("second"), phase: "tool" }, { ...summary("last"), phase: "reply" },
      ],
    });
    assert.deepEqual(await readCodexTurnRoutes("session", "exact-turn", new AbortController().signal, root), {
      ...summary("later"), turnOnly: true, requests: [
        { ...summary("first"), phase: "tool" }, { ...summary("second"), phase: "tool" },
        { ...summary("last"), phase: "model" }, { ...summary("later"), phase: "tool" },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
