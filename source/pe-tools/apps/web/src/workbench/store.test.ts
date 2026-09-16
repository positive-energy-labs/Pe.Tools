import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { expect, test, vi } from "vite-plus/test";

import { createChatPageStore } from "./store";

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

  store.actions.setLensInspectKey("tool-1");
  store.actions.setLensIntent({ kind: "turn", turn: 1 });
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

  expect(registry.get(store.atoms.lensInspectKey)).toBe("tool-1");
  expect(registry.get(store.atoms.lensFollowing)).toBe(false);
  expect(store.atoms.draft.label?.[0]).toContain("page/");
  expect(store.atoms.lensIntent.label?.[0]).toContain("widget/");
  expect(patches).toEqual([
    { partial: { mode: "world" }, replace: undefined },
    { partial: { thread: "thread-2" }, replace: true },
  ]);
  store.dispose();
});

test("send settlement clears only the draft that was sent", () => {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", prompt: "first", patch: async () => undefined },
  });
  const sent = registry.get(store.atoms.draft);

  store.actions.setDraft({ text: "second", attachments: [] });
  store.actions.clearDraftIfUnchanged(sent);
  expect(registry.get(store.atoms.draft).text).toBe("second");

  const second = registry.get(store.atoms.draft);
  store.actions.clearDraftIfUnchanged(second);
  expect(registry.get(store.atoms.draft)).toEqual({ text: "", attachments: [] });
  store.dispose();
});

test("the lens position intent has one owner; follow and the URL turn derive from it", async () => {
  vi.useFakeTimers();
  const registry = AtomRegistry.make();
  const patches: unknown[] = [];
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", turn: 4, patch: async (partial) => void patches.push(partial) },
  });
  expect(registry.get(store.atoms.lensIntent)).toEqual({ kind: "turn", turn: 4 });
  expect(registry.get(store.atoms.lensFollowing)).toBe(false);

  store.actions.setLensIntent({ kind: "turn", turn: 2 });
  store.actions.setLensIntent({ kind: "tail" });
  vi.advanceTimersByTime(2000);
  // Returning to the tail clears the URL turn at once and drops the pending turn write.
  expect(patches).toEqual([{ turn: undefined }]);
  expect(registry.get(store.atoms.lensFollowing)).toBe(true);

  store.actions.setLensIntent({ kind: "turn", turn: 3 });
  vi.advanceTimersByTime(2000);
  expect(patches).toEqual([{ turn: undefined }, { turn: 3 }]);
  store.dispose();
  vi.useRealTimers();
});
