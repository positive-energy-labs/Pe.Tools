// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsSettingFields, settingsSchema } from "@pe/agent-contracts";
import { publicRoutes } from "#/route/builtin-routes";
import { ductsGraph } from "#/ducts/graph";
import { peReadings } from "#/readings";
import { Route as root } from "../routes/__root";
import { settingsRoute, settingsAdapters } from "./route";
import { SurfaceHostProvider } from "#/navigation/surface-host";
import { MACHINE_SEEDS } from "#/open/seeds";
import type { GraphMount } from "#/shell/mount";
import type { SettingsPage } from "./graph";

vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
vi.mock("#/route/builtin-routes", async () => {
  const { createRouteRegistry } = await import("@pe/kit/route-registry");
  return { publicRoutes: createRouteRegistry() };
});
const releases: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  delete settingsAdapters.wrap;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("the mounted settings graph drives its section verb and edits another registered graph without Work or URL writes", async () => {
  releases.push(publicRoutes.registerGraph(ductsGraph, () => null));
  let values = settingsSchema(ductsSettingFields).parse({});
  let revision = 0;
  const writes: unknown[] = [];
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/pe/route-settings/ducts");
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        writes.push(body);
        expect(body.expectedRevision).toBe(revision);
        values = { ...values, ...body.patch };
        revision++;
      }
      return Response.json({ revision, values });
    }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.spyOn(settingsAdapters.sources["settings.machine"] as any, "open").mockImplementation(
    (_ctx: any, deliver: any) => {
      deliver({
        kind: "complete",
        revision: 0,
        value: { reading: MACHINE_SEEDS["patch-bay"], fixture: true },
      });
    },
  );
  let owner!: GraphMount<SettingsPage, unknown>;
  settingsAdapters.wrap = (mount, children) => {
    owner = mount;
    return children;
  };
  const router = createRouter({
    routeTree: root.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings?section=none"] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Body = settingsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <SurfaceHostProvider>
        <Body />
      </SurfaceHostProvider>
    </RouterContextProvider>,
  );
  await view.findByRole("region", { name: "Ducts settings" });
  await waitFor(() =>
    expect((view.getByLabelText("Grille airflow") as HTMLInputElement).disabled).toBe(false),
  );
  fireEvent.change(view.getByLabelText("Grille airflow"), { target: { value: "Design CFM" } });
  fireEvent.blur(view.getByLabelText("Grille airflow"));
  await waitFor(() => expect(values.terminalFlow).toBe("Design CFM"));
  expect(writes).toEqual([{ patch: { terminalFlow: "Design CFM" }, expectedRevision: 0 }]);
  await act(async () => {
    await owner.control("open-section", { section: "appearance" }).run();
  });
  await waitFor(() => expect(owner.view.read().page.section).toBe("appearance"));
  expect(owner.view.read().page).not.toHaveProperty("terminalFlow");
  expect(router.state.location.search).not.toHaveProperty("terminalFlow");
  expect(owner.snapshot().work).toBeNull();
});
