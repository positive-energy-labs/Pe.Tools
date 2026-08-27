import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { expect, test } from "vite-plus/test";

import { createChatPageStore } from "./store";

test("chat route store owns page atoms, URL projection, and verb receipts only", async () => {
  const registry = AtomRegistry.make();
  const patches: unknown[] = [];
  const store = createChatPageStore({
    registry,
    search: {
      mode: "threads",
      patch: (partial, replace) => patches.push({ partial, replace }),
    },
  });

  store.actions.setLensInspectKey("tool-1");
  store.actions.setLensFollowing(false);
  store.actions.setMode("world");
  store.actions.openThread("thread-2", true);
  await store.runVerb("inspect", async () => "inspected");

  expect(registry.get(store.atoms.lensInspectKey)).toBe("tool-1");
  expect(registry.get(store.atoms.lensFollowing)).toBe(false);
  expect(patches).toEqual([
    { partial: { mode: "world" }, replace: undefined },
    { partial: { thread: "thread-2" }, replace: true },
  ]);
  expect(registry.get(store.atoms.receipt)?.text).toBe("inspected");
  store.dispose();
});
