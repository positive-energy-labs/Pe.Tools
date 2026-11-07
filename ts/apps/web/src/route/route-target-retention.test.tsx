// @vitest-environment jsdom
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { address } from "@pe/agent-contracts";
import { useRouteTarget } from "./route-target";

const world = vi.hoisted(() => ({ inventory: {} as unknown }));
vi.mock("#/host/resource-state", async (original) => ({
  ...(await original<typeof import("#/host/resource-state")>()),
  readingAtom: (request: { kind: string }) => request,
}));
vi.mock("#/shell/owner", async (original) => ({
  ...(await original<typeof import("#/shell/owner")>()),
  useOwned: (_registry: unknown, atom: { kind: string } | null) =>
    atom?.kind === "inventory" ? world.inventory : null,
}));
afterEach(cleanup);

test.each([
  { session: "session", openId: "replacement" },
  { session: "replacement", openId: "original" },
])("Work retains Address on close only for the same lifetime (%j)", (replacement) => {
  const saved = address("C:/Models/Retained.rvt");
  const ref = { session: "session", openId: "original" };
  const inventory = (open: boolean) => ({
    state: "ready",
    observation: {
      sessions: [
        {
          sessionId: ref.session,
          connected: true,
          openDocuments: open
            ? [{ openId: ref.openId, title: "Retained", address: saved, isFamilyDocument: false }]
            : [],
        },
      ],
    },
  });
  world.inventory = inventory(true);
  const registry = AtomRegistry.make();
  const pin = (ref: typeof replacement) => JSON.stringify({ kind: "open", ref });
  const hook = renderHook(
    ({ target }) => useRouteTarget({ needs: "document" }, registry, undefined, target),
    {
      initialProps: { target: pin(ref) },
    },
  );
  expect(hook.result.current.resolution.kind).toBe("resolved");
  expect(hook.result.current.workAddress).toBe(saved);
  world.inventory = inventory(false);
  hook.rerender({ target: pin(ref) });
  expect(hook.result.current.resolution).toEqual({ kind: "choose", reason: "document-closed" });
  expect(hook.result.current.workAddress).toBe(saved);
  expect(hook.result.current.workOpen).toEqual(ref);
  hook.rerender({ target: pin(replacement) });
  expect(hook.result.current.workAddress).toBeNull();
  hook.unmount();
  registry.dispose();
});
