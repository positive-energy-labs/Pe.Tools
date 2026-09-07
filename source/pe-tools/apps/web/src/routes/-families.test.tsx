// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createFixtureFamiliesStore, fixtureFamiliesDraft } from "#/families/fixture";
import { FamiliesScopeBand } from "#/families/scope-band";
import type { FamiliesWorkspaceModel } from "#/families/workspace";
import { FamiliesWorkspaceProvider } from "#/families/workspace-context";

const callHostRpc = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { familiesSearch, FamiliesRouteContent } from "./families";

afterEach(cleanup);

describe("families fixture route", () => {
  it("mounts populated family review state without live host calls", async () => {
    expect(familiesSearch({ source: "fixture", thread: " review " })).toEqual({
      source: "fixture",
      thread: "review",
    });
    expect(familiesSearch({ source: "live" })).toEqual({
      source: undefined,
      thread: undefined,
    });

    const registry = AtomRegistry.make();
    const fixtureStore = createFixtureFamiliesStore(registry);
    expect(registry.get(fixtureStore.atoms.applied)).toEqual({
      placementScope: fixtureFamiliesDraft.placement,
      categoryNames: fixtureFamiliesDraft.categories,
      familyNames: fixtureFamiliesDraft.families,
    });
    expect(registry.get(fixtureStore.atoms.busy)).toBeNull();
    expect(registry.get(fixtureStore.atoms.failure)).toBeNull();
    fixtureStore.dispose();
    registry.dispose();

    render(
      <StrictMode>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <FamiliesRouteContent source="fixture" />
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByLabelText("draft families");

    expect(await screen.findByText(/6 families .* 14 types/)).toBeTruthy();
    expect(await screen.findByText("10 parameters")).toBeTruthy();
    expect(await screen.findByText("3 / 5 included")).toBeTruthy();
    expect(await screen.findByText("1 unclaimed")).toBeTruthy();
    expect(screen.getAllByText("VAV Terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Supply Diffuser").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Water Closet").length).toBeGreaterThan(0);
    expect(await screen.findByText("uncommon · 3 hidden")).toBeTruthy();
    expect(await screen.findByText("3 actions")).toBeTruthy();
    expect(await screen.findByText("0 actions")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(screen.queryByText("resolving families")).toBeNull();
    expect(screen.queryByText(/apply-scope failed/)).toBeNull();
    expect(screen.queryByText(/scope applied to/)).toBeNull();
    expect(callHostRpc).not.toHaveBeenCalled();
  });

  it("ignores stale family feed only when literal fixture families are present", () => {
    const registry = AtomRegistry.make();
    const store = createFixtureFamiliesStore(registry);
    const options = (names: string[]) => names.map((name) => ({ id: name, label: name }));
    const model = {
      fixture: true,
      store,
      selectedProfileQuery: null,
      placement: fixtureFamiliesDraft.placement,
      setPlacement: vi.fn(),
      draftCategories: fixtureFamiliesDraft.categories,
      categories: fixtureFamiliesDraft.categories,
      setDraftCategories: vi.fn(),
      pickedFamilies: fixtureFamiliesDraft.families,
      draftFamilyNames: fixtureFamiliesDraft.families,
      setPickedFamilies: vi.fn(),
      familyFeed: {
        options: options(fixtureFamiliesDraft.families),
        state: "ready",
        lane: "fixture",
        stale: true,
      },
      categoryFeed: {
        options: options(fixtureFamiliesDraft.categories),
        state: "ready",
        lane: "fixture",
        stale: false,
      },
      connected: true,
      matrixIssue: undefined,
    } as unknown as FamiliesWorkspaceModel;

    const view = render(
      <FamiliesWorkspaceProvider value={model}>
        <FamiliesScopeBand />
      </FamiliesWorkspaceProvider>,
    );

    expect(screen.queryByText("resolving families")).toBeNull();
    view.rerender(
      <FamiliesWorkspaceProvider value={{ ...model, fixture: false }}>
        <FamiliesScopeBand />
      </FamiliesWorkspaceProvider>,
    );
    expect(screen.getByText("resolving families")).toBeTruthy();
    store.dispose();
    registry.dispose();
  });
});
