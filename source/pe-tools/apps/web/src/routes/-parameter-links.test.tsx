// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const callHostRpc = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));
vi.mock("#/workbench/route-state", () => ({
  useRouteState: () => {
    throw new Error("fixture route mounted useRouteState transport");
  },
}));
vi.mock("#/workbench/route-scope", () => ({
  RouteScope: () => {
    throw new Error("fixture route mounted RouteScope");
  },
}));

import { parameterLinksSearch, ParameterLinksRouteContent } from "./parameter-links";

afterEach(cleanup);

describe("parameter-links fixture route", () => {
  it("mounts dense review state without route transport or Host calls", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    expect(parameterLinksSearch({ source: "fixture", thread: " review " })).toEqual({
      source: "fixture",
      thread: "review",
    });
    expect(parameterLinksSearch({ source: "live" })).toEqual({
      source: undefined,
      thread: undefined,
    });
    expect(parameterLinksSearch({ source: "Fixture" }).source).toBeUndefined();
    expect(parameterLinksSearch({ source: "fixture " }).source).toBeUndefined();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ParameterLinksRouteContent source="fixture" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/4 def .* 6 asn/)).toBeTruthy();
    expect(screen.getByText(/draft .* stored/)).toBeTruthy();
    expect(screen.getByDisplayValue("airflow-balance")).toBeTruthy();
    expect(screen.getByDisplayValue("circuit-connected-load")).toBeTruthy();
    expect(screen.getByDisplayValue("pump-design-flow")).toBeTruthy();
    expect(screen.getByDisplayValue("space-cooling-setpoint")).toBeTruthy();
    expect(screen.getByText("3 projected writes")).toBeTruthy();
    expect(screen.getByText("2 issues")).toBeTruthy();
    expect(screen.getByText("MULTIPLE_SOURCE_VALUES")).toBeTruthy();
    expect(screen.getByText("TARGET_PARAMETER_READ_ONLY")).toBeTruthy();
    expect(screen.getByText("600 GPM (override)")).toBeTruthy();
    expect(screen.getByText("3 active defs")).toBeTruthy();
    expect(screen.getByText("4 active asns")).toBeTruthy();
    expect(callHostRpc).not.toHaveBeenCalled();
  });
});
