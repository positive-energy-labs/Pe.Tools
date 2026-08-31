// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createFixtureFamilyStore } from "#/family/fixture";
import { appAtomRegistry } from "#/state/registry";
import { FamilyRouteContent, familySearch } from "./family";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("literal family fixture starts with authored review facts and no Host transport", async () => {
  const fetchMock = vi.fn();
  const eventSource = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", eventSource);

  expect(familySearch({ source: "fixture", thread: " review " })).toEqual({
    source: "fixture",
    thread: "review",
  });
  expect(familySearch({ source: "Fixture" }).source).toBeUndefined();
  expect(familySearch({ source: "fixture " }).source).toBeUndefined();

  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const store = createFixtureFamilyStore(registry);
  const world = registry.get(store.atoms.lane).world;
  expect(world.familyName).toBe("PE Fan Coil FC42");
  expect(world.typeNames).toEqual(["Compact", "Standard", "Tall"]);
  expect(world.params.map(({ name }) => name)).toContain("Body Width");
  expect(world.spec?.fileName).toBe("FC42-cut-sheet.pdf");
  store.dispose();
  registry.dispose();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RegistryContext.Provider value={appAtomRegistry}>
        <FamilyRouteContent source="fixture" />
      </RegistryContext.Provider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(document.body.textContent).toContain("FC42-cut-sheet.pdf"));
  expect(document.body.textContent).toContain("fixture · no host");
  expect(document.body.textContent).toContain("7 grounded · 4 open · 3 types");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(eventSource).not.toHaveBeenCalled();
});
