import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginButton, PluginClientContext, PluginSubscriptionHandle } from "@getpaseo/plugin/client";
import type { RouteState } from "../shared/route.ts";
import { contributeRoutes } from "./route-pills.ts";

const agent = { id: "synthetic-agent", workspaceId: "synthetic-workspace", provider: "codex", status: "idle" };
const active: RouteState = {
  state: "ready", message: "当前会话最近一次请求",
  route: { id: 1, time: "2026-01-01T00:00:00Z", asked: "group/requested", model: "vendor/actual", done: false, tries: [], bytes: 120 },
};

async function setup() {
  const buttons: { id: string; button: PluginButton; removed: boolean }[] = [];
  let observer: { snapshot(value: unknown): void; update(value: unknown): void };
  let emit: (state: RouteState) => void = () => {};
  let subscriptions = 0;
  let releases = 0;
  const client = {
    paseo: { agents: { list: async () => ({ subscription: { subscribe(value: typeof observer) { observer = value; } } }) } },
    subscribe(_contract: unknown, _input: unknown, onEvent: typeof emit) {
      subscriptions++;
      emit = onEvent;
      const release = () => { releases++; };
      return Object.assign(release, { ready: Promise.resolve(), release: async () => release() }) as PluginSubscriptionHandle;
    },
    addComposerPill(value: { id: string; button: PluginButton }) {
      const entry = { ...value, removed: false };
      buttons.push(entry);
      return { update(patch: Partial<PluginButton>) { entry.button = { ...entry.button, ...patch }; }, remove() { entry.removed = true; } };
    },
  } as unknown as PluginClientContext;
  const cleanup = contributeRoutes(client, () => ({ RouteIcon: () => null, RouteContent: () => null }));
  await Promise.resolve();
  await Promise.resolve();
  return {
    buttons, cleanup,
    snapshot: (value = agent) => observer!.snapshot({ entries: [{ agent: value }] }),
    update: (status: string) => observer!.update({ type: "agent_update", payload: { kind: "upsert", agent: { ...agent, status } } }),
    emit: (state: RouteState) => emit(state),
    counts: () => ({ subscriptions, releases }),
  };
}

test("hidden idle pills wake for a new running request and only the provider opens details", async () => {
  const x = await setup();
  x.snapshot();
  assert.equal(x.counts().subscriptions, 0);
  assert.deepEqual(x.buttons.map((entry) => entry.id), ["route", "route-traffic", "route-model"]);
  assert.ok(x.buttons.every((entry) => entry.button.visible === false));
  x.update("running");
  assert.equal(x.counts().subscriptions, 1);
  x.emit(active);
  assert.ok(x.buttons.every((entry) => entry.button.visible));
  assert.deepEqual(x.buttons.map((entry) => entry.button.label), ["vendor", "120 B", "actual"]);
  assert.deepEqual(x.buttons.map((entry) => entry.button.title), [
    "查看本次请求的 Magpie 实际路由",
    "当前会话的 Magpie 接收大小",
    "当前会话的 Magpie 实际模型",
  ]);
  assert.equal(x.buttons[0].button.behavior.kind, "popover");
  assert.ok(!x.buttons[0].button.disabled);
  assert.ok(x.buttons.slice(1).every((entry) => entry.button.disabled && entry.button.behavior.kind === "action"));
  x.emit({ ...active, route: { ...active.route!, done: true } });
  assert.ok(x.buttons.every((entry) => entry.button.visible === false));
  x.update("idle");
  assert.equal(x.counts().releases, 1);
  x.update("running");
  assert.equal(x.counts().subscriptions, 2);
  x.emit(active);
  assert.ok(x.buttons.every((entry) => entry.button.visible));
  x.cleanup();
  assert.ok(x.buttons.every((entry) => entry.removed));
});

test("failure or lost telemetry hides the whole route group and repeated updates do not resubscribe", async () => {
  const x = await setup();
  x.snapshot({ ...agent, status: "running" });
  x.emit(active);
  for (let n = 0; n < 5; n++) x.update("running");
  assert.equal(x.counts().subscriptions, 1);
  x.emit({ ...active, route: { ...active.route!, error: "failed" } });
  assert.ok(x.buttons.every((entry) => !entry.button.visible));
  x.emit({ state: "waiting_route", message: "暂无记录", route: null });
  assert.ok(x.buttons.every((entry) => !entry.button.visible));
  x.cleanup();
  x.emit(active);
  assert.ok(x.buttons.every((entry) => entry.removed));
});
