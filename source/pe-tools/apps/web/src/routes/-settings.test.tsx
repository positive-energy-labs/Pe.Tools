// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const callHostRpc = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostRpc }));

import { settingsSearch, SettingsRouteContent } from "./settings";

afterEach(cleanup);

describe("settings fixture route", () => {
  it("mounts the populated production workspace without live host calls", async () => {
    expect(settingsSearch({ source: "fixture", thread: " review " })).toEqual({
      source: "fixture",
      thread: "review",
    });
    expect(settingsSearch({ source: "live" })).toEqual({ source: undefined, thread: undefined });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SettingsRouteContent source="fixture" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByDisplayValue(
        "DX Fan Coil Unit Performance Schedule",
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
    expect(await screen.findByText("1 proposed")).toBeTruthy();
    expect(await screen.findByText("2 staged")).toBeTruthy();
    expect(await screen.findByText("1 invalid")).toBeTruthy();
    expect(callHostRpc).not.toHaveBeenCalled();
  });
});
