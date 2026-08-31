// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const callHostDynamic = vi.hoisted(() => vi.fn());
const callHostRpc = vi.hoisted(() => vi.fn());
const routeDocument = vi.hoisted(() => vi.fn());
vi.mock("#/host/client", () => ({ callHostDynamic, callHostRpc }));
vi.mock("#/workbench/route-document", () => ({
  RouteDocument: () => {
    routeDocument();
    return null;
  },
}));

import { OpsRoute } from "#/ops/route-workspace";
import { OPS_FIXTURE_CATALOG, OPS_FIXTURE_REQUEST } from "#/ops/fixture";
import { opsSearch } from "#/routes/ops";
import { appAtomRegistry } from "#/state/registry";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("renders the varied selected fixture without RouteDocument or Host calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(opsSearch({ source: "fixture", thread: "review" })).toEqual({
    source: "fixture",
    thread: "review",
  });
  expect(opsSearch({ source: "Fixture" })).toEqual({ source: undefined, thread: undefined });
  expect(opsSearch({ source: "fixture " })).toEqual({ source: undefined, thread: undefined });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RegistryContext.Provider value={appAtomRegistry}>
        <OpsRoute source="fixture" />
      </RegistryContext.Provider>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Visible Model Summary" })).toBeTruthy();
  const maxCategories = await screen.findByLabelText("maxCategories");
  expect(maxCategories).toHaveProperty("value", "12");
  fireEvent.click(screen.getByRole("button", { name: "raw" }));
  expect(screen.queryByLabelText("maxCategories")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveProperty("value", JSON.stringify(OPS_FIXTURE_REQUEST));
  expect(screen.getByText(/47 visible elements · 3 categories/)).toBeTruthy();
  expect(
    screen.getByText(
      "Warning CATEGORY_TRUNCATED: Air Terminals returned one representative element.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText("revit.context.visible-summary · 18ms · target = fixture-26"),
  ).toBeTruthy();

  const run = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
  expect(run.disabled).toBe(true);
  expect(run.title).toBe("fixture review refuses operation runs");
  fireEvent.click(run);

  expect(OPS_FIXTURE_CATALOG.map((operation) => operation.key)).toEqual([
    "host.ops.catalog",
    "revit.context.visible-summary",
    "revit.catalog.project-index",
    "revit.detail.schedules",
    "revit.apply.schedule",
    "settings.tree",
  ]);

  expect(routeDocument).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(callHostDynamic).not.toHaveBeenCalled();
  expect(callHostRpc).not.toHaveBeenCalled();
});
