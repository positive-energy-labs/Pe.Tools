import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { expect, test } from "vite-plus/test";

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
  store.actions.setLensFollowing(false);
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
  expect(store.atoms.lensFollowing.label?.[0]).toContain("widget/");
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
