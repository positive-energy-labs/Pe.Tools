// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runExport } from "#/runs/feedback/export";
import { liveRunsSource } from "#/runs/source";
import { fetchRunIndex, loadRunReport } from "#/runs/world";
import { RunsRouteContent, runsSearch } from "./runs";

afterEach(cleanup);

describe("runs fixture route", () => {
  it("renders dense production run state without fetch and preserves live loaders", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("fixture attempted fetch")));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    HTMLElement.prototype.scrollIntoView = vi.fn();

    expect(runsSearch({ source: "fixture" })).toEqual({ source: "fixture" });
    expect(runsSearch({ source: "Fixture" })).toEqual({ source: undefined });
    expect(runsSearch({ source: "fixture " })).toEqual({ source: undefined });
    expect(liveRunsSource.fetchRunIndex).toBe(fetchRunIndex);
    expect(liveRunsSource.loadRunReport).toBe(loadRunReport);
    expect(liveRunsSource.runExport).toBe(runExport);

    render(<RunsRouteContent source="fixture" />);

    expect(await screen.findByText("closure tuning candidate")).toBeTruthy();
    expect(await screen.findByText(/B: 3\/4 solved/)).toBeTruthy();
    expect(screen.getByText(/saved 0\.842 v1\.1/)).toBeTruthy();
    expect(screen.getByText(/4 runs .* 3 option sets/)).toBeTruthy();
    expect(await screen.findAllByText("no scores")).toHaveLength(4);
    expect(screen.getByText("Main Level")).toBeTruthy();
    expect(screen.getByText("Lower Level")).toBeTruthy();
    expect(screen.getByText("Upper Level")).toBeTruthy();
    expect(screen.getAllByText("plan unavailable in this package").length).toBeGreaterThan(0);
    expect(await screen.findByText("2 staged")).toBeTruthy();
    expect(screen.getByText("loaded from set fixture-review")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "copy for chat" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
