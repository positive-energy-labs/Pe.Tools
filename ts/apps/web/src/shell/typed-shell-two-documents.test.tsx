// @vitest-environment jsdom
// Drive 7 fix line 2: /fans with two documents open spun "Finding the open document" beside the picker.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { appAtomRegistry } from "#/shell/owner";
import { peReadings } from "#/host/resource-stream";
import { readingAtom } from "#/host/resource-state";
import { TypedShell } from "./typed-shell";

const world = vi.hoisted(() => ({ inventory: null as unknown, machine: null as unknown, atoms: new Map<unknown, string>() }));
vi.mock("#/shell/owner", async (original) => {
  const real = await original<typeof import("#/shell/owner")>();
  return {
    ...real,
    useOwned: (registry: never, atom: never) => {
      const kind = world.atoms.get(atom);
      return kind ? world[kind as "inventory" | "machine"] : real.useOwned(registry, atom);
    },
  };
});
afterEach(cleanup);

test("two open documents: the route settles on the picker, with no busy mark", async () => {
  peReadings.subscribe = () => () => {};
  world.atoms.set(readingAtom({ kind: "inventory" }, peReadings), "inventory");
  world.atoms.set(readingAtom({ kind: "machine" }, peReadings), "machine");
  const doc = (openId: string) => ({ openId, title: openId, address: null, isActive: false, isFamilyDocument: false });
  world.inventory = { state: "ready", observation: { sessions: [{ sessionId: "s1", connected: true, processId: 1, openDocuments: [doc("a"), doc("b")] }] } };
  // The machine census never answers here: no census can make one of two documents the sole one.
  world.machine = { state: "pending" };
  const { admit } = await import("../fans/admission.fixture");
  const fans = (await admit()).presenter;
  const root = createRootRoute({ component: () => <TypedShell module={fans.typed} fingerprint={fans.workFingerprint} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/fans"] }) });
  await router.load();
  render(<RegistryContext.Provider value={appAtomRegistry}><RouterProvider router={router} /></RegistryContext.Provider>);
  await screen.findByRole("button", { name: "Choose a document" });
  expect(screen.queryByText("Finding the open document")).toBeNull();
  expect(document.querySelectorAll("[aria-busy]")).toHaveLength(0);
});
