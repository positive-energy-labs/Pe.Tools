// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";
import { routeFile, useAddressPage } from "./address-page";
import { createRouteOwner, makeAtomRegistry, useOwned } from "./route-owner";
import { createViewOwner } from "./view-owner";
import { urlPage, useUrlPage } from "./url";
import { familyManifest } from "#/family/manifest";
import { manifest as families } from "#/families/manifest";
import { bindDuctsManifest } from "#/ducts/manifest";
import { defineRoute } from "./manifest";
import { useRoute } from "./use-route";

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

test("a capture landing survives a refreshed Family manifest and still restores Back and Forward", async () => {
  const manifest = familyManifest();
  const base = createRouteOwner("family", makeAtomRegistry());
  const owner = createViewOwner(
    base,
    manifest.page,
    { pod: "p" },
    {
      address: "family",
      transition: manifest.transition,
    },
  );
  const path = "settings/family/captured.json";
  function Probe() {
    const snapshot = useOwned(base.registry, owner.state)!;
    // Family refreshes its action facts when the captured member changes.
    const dynamicManifest = useMemo(() => familyManifest(), [snapshot.page.path]);
    const url = useMemo(() => urlPage(dynamicManifest), [dynamicManifest]);
    useUrlPage(url, owner);
    return (
      <>
        <output aria-label="path">{snapshot.page.path}</output>
        <button onClick={() => owner.move({ path }, {}, "action", owner.read())}>capture</button>
      </>
    );
  }
  const root = createRootRoute();
  const family = createRoute({
    getParentRoute: () => root,
    path: "/family",
    ...routeFile("family"),
    component: Probe,
  });
  const history = createMemoryHistory({ initialEntries: ["/family?pod=p"] });
  const router = createRouter({ routeTree: root.addChildren([family]), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const at = () => routeAddress("family").read(router.state.location.search).page.path;
  try {
    await waitFor(() => expect(view.getByLabelText("path")).toBeTruthy());
    fireEvent.click(view.getByText("capture"));
    await waitFor(() => expect(at()).toBe(path));
    expect(owner.read().page.path).toBe(path);
    act(() => history.back());
    await waitFor(() => expect(owner.read().page.path).toBe(""));
    expect(at()).toBe("");
    act(() => history.forward());
    await waitFor(() => expect(owner.read().page.path).toBe(path));
    expect(at()).toBe(path);
  } finally {
    view.unmount();
    owner.dispose();
    base.dispose();
  }
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
    expect(owner.move({ system: ["C"] })).toMatchObject({ code: "not-ready" });
  } finally {
    owner.dispose();
    route.dispose();
  }
});

async function pendingCapture() {
  let complete!: () => void;
  const captured = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let navigate!: (path: string) => void;
  function Family() {
    // Family's authoring facts rebuild its behavior as observations arrive. The Page contract stays.
    const handle = useRoute(
      defineRoute({
        key: "family",
        name: "Family",
        address: "family",
        page: routeAddress("family").schema,
        actions: {
          capture: {
            label: "capture",
            says: "File the captured member",
            needs: "host",
            effect: "query",
            input: z.void() as unknown as z.ZodType<never>,
            dirties: [],
            ready: () => null,
            run: async (ctx) => {
              await captured;
              ctx.setPage({ path: "captures/new.json" });
            },
          },
        },
      }),
    );
    navigate = (path) => handle.page[1]({ path });
    return (
      <>
        <output aria-label="member">{handle.page[0].path}</output>
        <button onClick={() => void handle.actions.capture.run()}>capture</button>
      </>
    );
  }
  const root = createRootRoute();
  const family = createRoute({
    getParentRoute: () => root,
    path: "/family",
    ...routeFile("family"),
    component: Family,
  });
  const history = createMemoryHistory({ initialEntries: ["/family?pod=office"] });
  const router = createRouter({ routeTree: root.addChildren([family]), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(view.getByText("capture")).toBeTruthy());
  return {
    complete,
    navigate: (path: string) => navigate(path),
    view,
    place: () => routeAddress("family").read(router.state.location.search).page,
  };
}

test("a capture lands its member when observation-driven behavior refreshes the same Page contract", async () => {
  const probe = await pendingCapture();
  fireEvent.click(probe.view.getByText("capture"));
  await act(async () => probe.complete());
  await waitFor(() => expect(probe.place().path).toBe("captures/new.json"));
  expect(probe.view.getByLabelText("member").textContent).toBe("captures/new.json");
});

test("a capture never replaces a member the person navigated to while it ran", async () => {
  const probe = await pendingCapture();
  fireEvent.click(probe.view.getByText("capture"));
  await act(async () => probe.navigate("settings/chosen.json"));
  await waitFor(() => expect(probe.place().path).toBe("settings/chosen.json"));
  await act(async () => probe.complete());
  expect(probe.place().path).toBe("settings/chosen.json");
  expect(probe.view.getByLabelText("member").textContent).toBe("settings/chosen.json");
});
