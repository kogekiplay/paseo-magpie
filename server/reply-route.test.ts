import assert from "node:assert/strict";
import { test } from "node:test";
import { finalReplyId, matchReplyRoute } from "./reply-route.ts";

test("a plugin row can follow the final reply without hiding it or masking a newer turn", () => {
  const reply = { turnId: "turn-a", item: { type: "assistant_message", text: "Done", messageId: "msg_final" } } as const;
  const footer = { item: { type: "plugin", id: "timing", pluginId: "timing", kind: "turn-time", version: 1, data: {} } } as const;
  assert.equal(finalReplyId([reply, footer], "turn-a"), "msg_final");
  assert.equal(finalReplyId([reply, footer, { turnId: "turn-b", item: { type: "user_message", text: "Continue" } }], "turn-a"), undefined);
});

const route = {
  agent: "claude", session: "session-a", responseId: "msg_answer", done: true, status: 200,
  provider: "first", order: [{ id: "private-seat-a", provider: "first" }],
  left: [{ id: "private-seat-b", provider: "second" }],
  tries: [
    { id: "private-seat-a", model: "requested", done: true, status: 429, fail: "private upstream error" },
    { id: "private-seat-b", model: "alias", served: "actual-model", done: true, status: 200 },
  ],
};
const trace = (...routes: unknown[]) => ({ object: "trace", routes });

test("matches the exact final reply even when another request finished later", () => {
  const data = trace(
    { ...route, responseId: "msg_tool_call" },
    route,
    { ...route, responseId: "msg_newest" },
    { ...route, session: "session-b" },
  );
  assert.deepEqual(matchReplyRoute(data, "session-a", "msg_answer"), {
    provider: "second", model: "actual-model", attempts: [
      { route: "first/requested", status: 429, failed: true },
      { route: "second/actual-model", status: 200, failed: false },
    ],
  });
});

test("does not attribute auxiliary, unfinished, canceled, or ambiguous requests", () => {
  for (const data of [
    trace({ ...route, kind: "title" }),
    trace({ ...route, subagentId: "helper" }),
    trace({ ...route, done: false }),
    trace({ ...route, canceled: true }),
    trace({ ...route, status: 503 }),
    trace({ ...route, responseId: "msg_other" }),
    trace({ ...route, agent: "codex" }),
    trace(route, route),
  ]) {
    assert.equal(matchReplyRoute(data, "session-a", "msg_answer"), null);
  }
});
