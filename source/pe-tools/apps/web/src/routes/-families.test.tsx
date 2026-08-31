// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createFixtureFamiliesStore, fixtureFamiliesDraft } from "#/families/fixture";

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

    expect(await screen.findByText(/6 families .* 14 types .* 10 parameters/)).toBeTruthy();
    expect(
      await screen.findByText(/3 of 5 planned families included .* 1 in scope but unclaimed/),
    ).toBeTruthy();
    expect(screen.getAllByText("VAV Terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Supply Diffuser").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Water Closet").length).toBeGreaterThan(0);
    expect(await screen.findByText("3 uncommon params hidden")).toBeTruthy();
    expect(await screen.findByText("3 actions")).toBeTruthy();
    expect(await screen.findByText("0 actions")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("resolving families")).toBeNull();
      expect(screen.queryByText(/apply-scope failed/)).toBeNull();
      expect(screen.queryByText(/scope applied to/)).toBeNull();
    });
    expect(callHostRpc).not.toHaveBeenCalled();
  });
});
