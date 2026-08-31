// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const callHostRpc = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import {
  createFixtureFamiliesStore,
  fixtureFamiliesDraft,
  fixtureFamilyRows,
} from "#/families/fixture";
import { appAtomRegistry } from "#/state/registry";
import { familiesSearch, FamiliesRouteContent } from "./families";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("families fixture route", () => {
  it("starts with the exact review matrix and makes no Host transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(familiesSearch({ source: "fixture", thread: " review " })).toEqual({
      source: "fixture",
      thread: "review",
    });
    expect(familiesSearch({ source: "live" })).toEqual({
      source: undefined,
      thread: undefined,
    });

    const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
    const store = createFixtureFamiliesStore(registry);
    expect(registry.get(store.atoms.draft)).toEqual(fixtureFamiliesDraft);
    expect(registry.get(store.atoms.applied)?.familyNames).toEqual(fixtureFamiliesDraft.families);
    expect(fixtureFamilyRows.map(({ familyName }) => familyName)).toEqual([
      "Desk",
      "VAV Terminal",
      "Fan Coil Unit",
      "Supply Diffuser",
      "Inline Pump",
      "Water Closet",
    ]);
    expect(fixtureFamilyRows.flatMap(({ typeNames }) => typeNames)).toHaveLength(14);
    expect(
      new Set(
        fixtureFamilyRows.flatMap(({ parameters }) =>
          parameters.map(({ definition }) => definition.identity.name),
        ),
      ).size,
    ).toBe(10);
    store.dispose();
    registry.dispose();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RegistryContext.Provider value={appAtomRegistry}>
          <FamiliesRouteContent source="fixture" />
        </RegistryContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/6 families .* 14 types .* 10 parameters/)).toBeTruthy();
    expect(screen.getAllByText("VAV Terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Supply Diffuser").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Water Closet").length).toBeGreaterThan(0);
    expect(callHostRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
