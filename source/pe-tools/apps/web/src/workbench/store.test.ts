import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { expect, test, vi } from "vite-plus/test";

import { createChatPageStore } from "./store";
import { createCurrentThreadView } from "./thread-view";

test("chat store separates Page state, widget mechanics, URL projection, and verb receipts", async () => {
  const registry = AtomRegistry.make();
  const patches: unknown[] = [];
  const store = createChatPageStore({
    registry,
    search: {
      mode: "threads",
      patch: async (partial, replace) => void patches.push({ partial, replace }),
    },
  });
  const view = createCurrentThreadView({ registry, patch: async () => undefined });

  view.actions.setLensInspectKey("tool-1");
  view.actions.setLensIntent({ kind: "turn", turn: 1 });
  store.actions.setMode("world");
  store.actions.setPluginOpen(true);
  expect(registry.get(store.atoms.sideOpen)).toBe(false);
  expect(registry.get(store.atoms.pluginOpen)).toBe(true);
  store.actions.setSideOpen(true);
  expect(registry.get(store.atoms.pluginOpen)).toBe(false);
  store.actions.setPluginOpen(false);
  expect(registry.get(store.atoms.sideOpen)).toBe(true);
  await store.actions.openThread("thread-2", true);
  await store.runAction("inspect", async () => null);

  expect(registry.get(view.atoms.lensInspectKey)).toBe("tool-1");
  expect(registry.get(view.atoms.lensFollowing)).toBe(false);
  expect(view.atoms.lensIntent.label?.[0]).toContain("widget/");
  expect(patches).toEqual([
    { partial: { mode: "world" }, replace: undefined },
    { partial: { thread: "thread-2", prompt: undefined, turn: undefined }, replace: true },
  ]);
  store.dispose();
  view.dispose();
});

test("thread navigation strips one-time prompt and focal turn together", async () => {
  const registry = AtomRegistry.make();
  const patches: unknown[] = [];
  const store = createChatPageStore({
    registry,
    search: {
      mode: "threads",
      prompt: "first",
      turn: 2,
      patch: async (partial) => void patches.push(partial),
    },
  });
  await store.actions.openThread("thread-2");
  expect(patches).toEqual([{ thread: "thread-2", prompt: undefined, turn: undefined }]);
  store.dispose();
});

test("the lens position intent has one owner; follow and the URL turn derive from it", async () => {
  vi.useFakeTimers();
  const registry = AtomRegistry.make();
  const patches: unknown[] = [];
  const view = createCurrentThreadView({
    registry,
    turn: 4,
    patch: async (partial) => void patches.push(partial),
  });
  expect(registry.get(view.atoms.lensIntent)).toEqual({ kind: "turn", turn: 4 });
  expect(registry.get(view.atoms.lensFollowing)).toBe(false);

  view.actions.setLensIntent({ kind: "turn", turn: 2 });
  view.actions.setLensIntent({ kind: "tail" });
  vi.advanceTimersByTime(2000);
  // Returning to the tail clears the URL turn at once and drops the pending turn write.
  expect(patches).toEqual([{ turn: undefined }]);
  expect(registry.get(view.atoms.lensFollowing)).toBe(true);

  view.actions.setLensIntent({ kind: "turn", turn: 3 });
  vi.advanceTimersByTime(2000);
  expect(patches).toEqual([{ turn: undefined }, { turn: 3 }]);
  view.dispose();
  vi.useRealTimers();
});
