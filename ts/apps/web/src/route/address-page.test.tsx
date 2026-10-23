// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, test } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { routeFile, useAddressPage } from "./address-page";
import { createRouteOwner, makeAtomRegistry } from "./route-owner";
import { createViewOwner } from "./view-owner";
import { urlPage } from "./url";
import { manifest as families } from "#/families/manifest";
import { bindDuctsManifest } from "#/ducts/manifest";

afterEach(cleanup);

/** A route that is only its address: Ops. The page is read, moved and restored like a manifest route's. */
function Ops() {
  const [{ op, actionId }, setPage] = useAddressPage("ops");
  return (
    <div>
      <output aria-label="page">{`${op}|${actionId}`}</output>
      <button onClick={() => setPage({ op: "revit.b", actionId: "" })}>pick</button>
      <button onClick={() => setPage({ actionId: "a1" })}>receipt</button>
    </div>
  );
}

async function mount(entry: string) {
  const root = createRootRoute();
  const ops = createRoute({
    getParentRoute: () => root,
    path: "/ops",
    ...routeFile("ops"),
    component: Ops,
  });
  const history = createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({ routeTree: root.addChildren([ops]), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const page = () => view.getByLabelText("page").textContent;
  const place = () =>
    routeAddress("ops").read(router.state.location.search as Record<string, unknown>).page;
  await waitFor(() => expect(page()).toBeTruthy());
  return { view, history, page, place };
}

test("a deep link reopens the same view", async () => {
  const { page } = await mount("/ops?op=revit.a&actionId=r9");
  expect(page()).toBe("revit.a|r9");
});

test("a pick pushes an entry, a receipt replaces, and Back restores the pick", async () => {
  const { view, history, page, place } = await mount("/ops?op=revit.a");
  fireEvent.click(view.getByText("pick"));
  await waitFor(() => expect(page()).toBe("revit.b|"));
  expect(history.length).toBe(2);
  fireEvent.click(view.getByText("receipt"));
  await waitFor(() => expect(place().actionId).toBe("a1"));
  expect(history.length).toBe(2);
  expect(page()).toBe("revit.b|a1");
  act(() => history.back());
  await waitFor(() => expect(page()).toBe("revit.a|"));
});

test("restoring Families spec B after planning A closes A's confirmation in one publication", () => {
  const route = createRouteOwner("families", makeAtomRegistry());
  const url = urlPage(families)!;
  const owner = createViewOwner(
    route,
    families.page,
    url.read({ stage: "apply", pod: "p", path: "b.json" }),
    { address: families.address, transition: families.transition },
  );
  owner.setPage({ path: "a.json" });
  owner.move({ confirming: true, sheet: { entries: [] } }, {}, "action");
  expect(owner.read().page.confirming).toBe(true);
  owner.move(url.read({ stage: "apply", pod: "p", path: "a.json", query: "Wall" }), {}, "url");
  expect(owner.read().page.confirming).toBe(true);
  const seen: ReturnType<typeof owner.read>[] = [];
  const unsubscribe = owner.subscribe(() => seen.push(owner.read()));
  try {
    expect(
      owner.move(url.read({ stage: "apply", pod: "p", path: "b.json" }), {}, "url"),
    ).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.page).toMatchObject({ path: "b.json", confirming: false, sheet: null });
  } finally {
    unsubscribe();
    owner.dispose();
    route.dispose();
  }
});

test("a Ducts URL atomically restores system, selection and pose before its evidence loads", () => {
  const manifest = bindDuctsManifest(() => null);
  const route = createRouteOwner("ducts", makeAtomRegistry());
  const url = urlPage(manifest)!;
  const owner = createViewOwner(route, manifest.page, url.read({ system: "A" }), {
    address: manifest.address,
    transition: manifest.transition,
  });
  try {
    const restored = url.read({ system: "B", selected: "200", viewport: "orbit:45,30,1.25@0,0,0" });
    expect(owner.move(restored, {}, "url")).toBeNull();
    expect(owner.read().page).toMatchObject(restored);
    expect(owner.read().page.selected).toBe("200");
    expect(owner.read().page.viewport).not.toBeNull();
    expect(owner.move({ system: "C" })).toMatchObject({ code: "not-ready" });
  } finally {
    owner.dispose();
    route.dispose();
  }
});
