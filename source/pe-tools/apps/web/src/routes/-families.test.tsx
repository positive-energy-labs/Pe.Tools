// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FamiliesRouteContent source="fixture" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 families · 1 types · 1 parameters")).toBeTruthy();
    expect(await screen.findByText(/1 of 1 planned families included/)).toBeTruthy();
    expect(screen.getAllByText("Desk").length).toBeGreaterThan(0);
    expect(await screen.findByText("1 action")).toBeTruthy();
    expect(callHostRpc).not.toHaveBeenCalled();
  });
});
