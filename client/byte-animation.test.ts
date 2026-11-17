import assert from "node:assert/strict";
import { test } from "node:test";
import { createByteAnimation } from "./byte-animation.ts";

function setup() {
  let now = 0;
  const pending = new Set<() => void>();
  const frames: (number | undefined)[] = [];
  const animation = createByteAnimation((value) => frames.push(value), {
    now: () => now,
    schedule: (callback) => { pending.add(callback); return () => { pending.delete(callback); }; },
  });
  return { animation, frames, pending, advance(ms: number) {
    now += ms;
    const callbacks = [...pending];
    pending.clear();
    for (const callback of callbacks) callback();
  } };
}

test("byte animation rises smoothly between confirmed readings without overshooting", () => {
  const { animation, frames, pending, advance } = setup();
  animation.update("request-A", 12, true);
  assert.equal(frames.at(-1), 12);
  animation.update("request-A", 2048, true);
  advance(90);
  assert.ok(frames.at(-1)! > 12 && frames.at(-1)! < 2048);
  advance(90);
  assert.equal(frames.at(-1), 2048);
  assert.equal(pending.size, 0);
});

test("a new request, missing data or failure cancels old frames instead of mixing traffic", () => {
  for (const [key, bytes, animate] of [["request-B", 0, true], [undefined, undefined, true], ["request-A", 99, false]] as const) {
    const { animation, frames, pending, advance } = setup();
    animation.update("request-A", 1000, true);
    animation.update("request-A", 2000, true);
    const delayed = [...pending];
    animation.update(key, bytes, animate);
    advance(200);
    for (const callback of delayed) callback();
    assert.equal(frames.at(-1), bytes);
    assert.equal(pending.size, 0);
  }
});

test("new readings replace in-flight targets and disposal prevents late updates", () => {
  const { animation, frames, pending, advance } = setup();
  animation.update("request-A", 10, true);
  animation.update("request-A", 1000, true);
  advance(90);
  const mid = frames.at(-1)!;
  animation.update("request-A", 2000, true);
  assert.equal(frames.at(-1), mid);
  advance(180);
  assert.equal(frames.at(-1), 2000);
  animation.update("request-A", 3000, true);
  const delayed = [...pending];
  animation.dispose();
  const length = frames.length;
  advance(200);
  for (const callback of delayed) callback();
  animation.update("request-A", 4000, true);
  assert.equal(frames.length, length);
});
