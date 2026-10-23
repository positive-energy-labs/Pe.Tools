// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { RouteActivity, type RouteActivityScope } from "./activity";
import { routeFile } from "./address-page";
import { createRouteOwner, makeAtomRegistry, useOwned } from "./route-owner";
import { routeUrlPage, useUrlPage } from "./url";
import { createViewOwner } from "./view-owner";

afterEach(cleanup);

async function mount(current = false) {
  const registry = makeAtomRegistry();
  const base = createRouteOwner("space", registry);
  const owner = createViewOwner(base, routeAddress("space").schema, {}, { address: "space" });
  const scope: RouteActivityScope = {
    pathname: "/space",
    search: {},
    current: () => current,
    retain: () => {},
    retire: () => {},
  };
  function Probe() {
    const snapshot = useOwned(registry, owner.state);
    useUrlPage(routeUrlPage("space"), owner);
    return <output aria-label="mode">{snapshot?.page.mode ?? "unenrolled"}</output>;
  }
  const root = createRootRoute();
  const space = createRoute({
    getParentRoute: () => root,
    path: "/space",
    ...routeFile("space"),
    component: Probe,
  });
  const history = createMemoryHistory({ initialEntries: ["/space"] });
  const router = createRouter({ routeTree: root.addChildren([space]), history });
  await router.load();
  const tree = (hidden = false) => (
    <RouteActivity.Provider value={scope}>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <RouterProvider router={router} />
      </Activity>
    </RouteActivity.Provider>
  );
  const view = render(tree());
  return {
    owner,
    history,
    view,
    mode: () => view.getByLabelText("mode").textContent,
    place: () => routeAddress("space").read(router.state.location.search).page,
    enroll: () => {
      current = true;
    },
    loseCustody: () => {
      current = false;
    },
    hide: () => {
      current = false;
      view.rerender(tree(true));
    },
    show: () => {
      current = true;
      view.rerender(tree());
    },
    dispose: () => {
      view.unmount();
      owner.dispose();
      base.dispose();
      registry.dispose();
    },
  };
}

test("a stable scope starts publishing owner changes after delayed enrollment", async () => {
  const probe = await mount();
  try {
    expect(probe.mode()).toBe("unenrolled");
    probe.enroll();
    act(() => probe.owner.setPage({ mode: "top" }));
    await waitFor(() => expect(probe.mode()).toBe("top"));
  } finally {
    probe.dispose();
  }
});

test("a stable scope starts projecting Page changes to the URL after delayed enrollment", async () => {
  const probe = await mount();
  try {
    probe.enroll();
    act(() =>
      probe.owner.setPage({
        scene: "720b116fa3b846c8d8555b36ed4f33d2e6756c935d5772f124ab4f3ebe7ff67e",
      }),
    );
    await waitFor(() =>
      expect(probe.place().scene).toBe(
        "720b116fa3b846c8d8555b36ed4f33d2e6756c935d5772f124ab4f3ebe7ff67e",
      ),
    );
    act(() => probe.owner.setPage({ mode: "top" }));
    await waitFor(() => expect(probe.place().mode).toBe("top"));
  } finally {
    probe.dispose();
  }
});

test("hidden owners cannot write the URL and reactivation restores the address before new moves", async () => {
  const probe = await mount(true);
  try {
    await act(async () => probe.hide());
    const before = probe.history.location.href;
    await act(async () =>
      probe.owner.setPage({
        mode: "top",
        scene: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(probe.history.location.href).toBe(before);
    await act(async () => probe.show());
    await waitFor(() => expect(probe.mode()).toBe("3d"));
    expect(probe.owner.read().page.scene).toBeUndefined();
    act(() => probe.owner.setPage({ mode: "top" }));
    await waitFor(() => expect(probe.place().mode).toBe("top"));
    expect(probe.mode()).toBe("top");
  } finally {
    probe.dispose();
  }
});

test("callbacks lose external custody immediately even before Activity disconnects effects", async () => {
  const probe = await mount(true);
  try {
    expect(probe.mode()).toBe("3d");
    probe.loseCustody();
    const before = probe.history.location.href;
    await act(async () => probe.owner.setPage({ mode: "top" }));
    expect(probe.history.location.href).toBe(before);
    expect(probe.mode()).toBe("3d");
    probe.enroll();
    act(() => probe.owner.setPage({ mode: "north" }));
    await waitFor(() => expect(probe.mode()).toBe("north"));
    await waitFor(() => expect(probe.place().mode).toBe("north"));
  } finally {
    probe.dispose();
  }
});
