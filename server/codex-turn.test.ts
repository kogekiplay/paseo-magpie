import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { completedTurnForMessage, findCodexTurn } from "./codex-turn.ts";

const session = "018cc251-f400-7000-8000-000000000000"; // 2024-01-01T00:00:00Z
const turn = "018cc252-0400-7000-8000-000000000000";
const otherTurn = "018cc252-1400-7000-8000-000000000000";
const signal = new AbortController().signal;
const event = (type: string, payload: Record<string, unknown>) => JSON.stringify({ type, payload });
const task = (type: string, turnId = turn) => event("event_msg", { type, turn_id: turnId, root_turn_id: turnId });
const answer = (id: string, phase = "final_answer") => event("response_item", { type: "message", role: "assistant", phase, id });

test("recovers only an exact final message inside a completed native turn", () => {
  const start = task("task_started");
  const end = task("task_complete");
  const final = answer("msg_final");
  assert.equal(completedTurnForMessage([start, answer("msg_note", "commentary"), final, end, task("task_started", otherTurn)], "msg_final"), turn);
  for (const lines of [
    [final, end], [start, final], [start, final, task("task_complete", otherTurn)],
    [start, answer("msg_final", "commentary"), end], [start, final, answer("msg_other"), end],
    [start, final, task("turn_aborted"), end], [start, final, end, start, final, end],
  ]) assert.equal(completedTurnForMessage(lines, "msg_final"), undefined);
});

test("reads the matching Codex session on an adjacent local date and checks its header", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-magpie-codex-turn-"));
  try {
    const dir = join(root, "sessions", "2023", "12", "31");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `rollout-2023-12-31T19-00-00-${session}.jsonl`);
    const body = [task("task_started"), answer("msg_final"), task("task_complete"), ""].join("\n");
    await writeFile(path, `${event("session_meta", { id: otherTurn })}\n${body}`, { mode: 0o600 });
    assert.equal(await findCodexTurn(session, "msg_final", signal, root), undefined);
    await writeFile(path, `${event("session_meta", { id: session })}\n${body}`);
    assert.equal(await findCodexTurn(session, "msg_final", signal, root), turn);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
