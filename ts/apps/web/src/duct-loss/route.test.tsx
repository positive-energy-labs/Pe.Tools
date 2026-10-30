// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, expect, test } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { readKeyMeta, readRegistrations } from "@pe/kit/keys";
import { readTeaching } from "@pe/kit/lang/teach";
import { solve } from "#/duct/math";
import { Route as root } from "../routes/__root";
import { ductLossGraph } from "./graph";
import { ductLossRoute } from "./route";

const releases: (() => void)[] = [];
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  // useRouteOwner defers disposal so StrictMode can remount the same owner.
  await new Promise((resolve) => setTimeout(resolve, 5));
});

async function mounted(url = "/duct-loss") {
  const router = createRouter({
    routeTree: root.addChildren([ductLossRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  // RouterContextProvider omits Matches/Transitioner, which normally owns this subscription.
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = ductLossRoute.options.component!;
  // Supply the real router context without mounting unrelated, host-dependent app chrome.
  // The component, adapters, reading graph, kit panes and key scopes are all production code.
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("friction loss");
  const inputs = view.container.querySelector<HTMLElement>("[data-pane-id='inputs']")!;
  return { view, router, inputs: within(inputs) };
}

const fmt = (n: number, digits: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });

test("a shared URL restores every graph field and the real solve, and edits round-trip through Page", async () => {
  const page = {
    shape: "rect" as const,
    a: 24,
    b: 10,
    cfm: 1800,
    length: 75,
    roughness: 0.003,
    density: 0.07,
    face: "residential" as const,
  };
  const address = routeAddress("duct-loss");
  const { view, router, inputs } = await mounted(address.link(page));
  expect(router.routesByPath["/duct-loss"]).toBe(ductLossRoute);
  const search = () => router.state.location.search;
  expect(address.read(search()).page).toMatchObject(page);
  const situation = within(view.getByLabelText("Situation"));
  expect(situation.getByRole("button", { name: "Choose shape" }).textContent).toBe("rect");
  for (const [id, name] of [
    ["a", /^width/],
    ["b", /^height/],
    ["cfm", /^airflow/],
    ["length", /^length/],
    ["roughness", /^roughness/],
    ["density", /^density/],
  ] as const)
    expect((inputs.getByRole("spinbutton", { name }) as HTMLInputElement).value).toBe(
      String(page[id]),
    );
  expect(inputs.getByRole("button", { name: "residential" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(view.getByLabelText("friction loss").textContent).toBe(
    `Δp ${fmt(solve(page).loss, 3)} in. wg`,
  );
  expect(view.getByLabelText("velocity V").textContent).toContain(fmt(solve(page).velocity, 0));

  const length = router.history.length;
  fireEvent.change(inputs.getByRole("spinbutton", { name: /^airflow/ }), {
    target: { value: "2400" },
  });
  expect((inputs.getByRole("spinbutton", { name: /^airflow/ }) as HTMLInputElement).value).toBe(
    "2400",
  );
  await waitFor(() => expect(Number(search().cfm)).toBe(2400));
  expect((inputs.getByRole("spinbutton", { name: /^airflow/ }) as HTMLInputElement).value).toBe(
    "2400",
  );
  expect(view.getByLabelText("friction loss").textContent).toBe(
    `Δp ${fmt(solve({ ...page, cfm: 2400 }).loss, 3)} in. wg`,
  );
  expect(router.history.length).toBe(length);
  const editedUrl = router.state.location.href;
  view.unmount();
  const reopened = await mounted(editedUrl);
  expect(reopened.view.getByLabelText("friction loss").textContent).toBe(
    `Δp ${fmt(solve({ ...page, cfm: 2400 }).loss, 3)} in. wg`,
  );
});

test("the graph supplies its stage and pane key scopes, with only kernel journal bindings", async () => {
  const { view } = await mounted();
  const scopes = readTeaching().flatMap((entry) => (entry.kind === "keys" ? [entry.scope] : []));
  expect(scopes).toContain(ductLossGraph.key);
  expect(scopes).toContain(`${ductLossGraph.key}:${Object.keys(ductLossGraph.stages)[0]}`);
  for (const id of Object.keys(ductLossGraph.panes)) {
    expect(scopes).toContain(id);
    expect(view.container.querySelector(`[data-pane-id='${id}']`)).not.toBeNull();
  }
  const bindings = () =>
    readRegistrations().flatMap((entry) => {
      const meta = readKeyMeta(entry.options.meta);
      return meta?.scope === ductLossGraph.key ? [meta] : [];
    });
  expect(
    [...new Set(bindings().map((entry) => entry.actionId))].sort((a, b) =>
      String(a).localeCompare(String(b)),
    ),
  ).toEqual(["duct-loss.redo", "duct-loss.undo"]);
  expect(ductLossGraph.verbs).toEqual({});
  view.unmount();
  await waitFor(() => expect(bindings()).toEqual([]));
});

test("independent renders without ?at= show the same fields, solve and real wheel/chart geometry", async () => {
  const snapshot = async () => {
    const { view, router } = await mounted("/duct-loss?cfm=1350&a=14");
    expect(router.state.location.search).not.toHaveProperty("at");
    const state = {
      inputs: Array.from(
        view.container.querySelectorAll("input, select"),
        (element) => (element as HTMLInputElement).value,
      ),
      readings: Array.from(
        view.container.querySelectorAll("output"),
        (element) => element.textContent,
      ),
      geometry: Array.from(view.container.querySelectorAll("svg"), (element) => element.outerHTML),
    };
    expect(state.geometry.length).toBeGreaterThanOrEqual(5);
    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    return state;
  };
  expect(await snapshot()).toEqual(await snapshot());
});
