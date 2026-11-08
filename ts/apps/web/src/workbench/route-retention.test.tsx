// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter,
  RouterProvider, RouterContextProvider, useRouterState, useRouter } from "@tanstack/react-router";
import { useRouteActivity, type RouteActivityScope } from "#/route/activity";
import { RouteRetention } from "./route-retention";
import { PlaceBoundary, admittedRouterAddress } from "#/shell/typed-place-boundary";
import type { AdmittedPlace } from "#/shell/typed-place";
afterEach(cleanup);

test.each(["families", "fans", "ducts"])("N-03 %s retains codec bytes before resolving Page or target on return", async (route) => {
  const query = new URLSearchParams({
    subject: JSON.stringify({ kind: "ids", ids: ["one"] }),
    selected: JSON.stringify([{ kind: "item", id: "one" }]),
    pose: JSON.stringify({ x: 21, y: 34 }),
    target: JSON.stringify({ kind: "open", ref: { session: "primary", openId: "document" } }),
  });
  const path = `/${route}`;
  const tab = { id: "11111111-1111-4111-8111-111111111111", route, link: `${path}?${query}`, at: "2026-11-07T03:00:00.000Z" };
  const identity = {};
  let held: AdmittedPlace<{ dispose(): void }> | undefined;
  function Tool() {
    const router = useRouter();
    const address = useMemo(() => admittedRouterAddress(router.history), [router]);
    return <PlaceBoundary identity={identity} path={path} address={address}>{place => {
      held = place;
      return <output>{place.address.read().toString()}</output>;
    }}</PlaceBoundary>;
  }
  function Root() {
    const location = useRouterState({ select: (state) => state.location });
    return <RouteRetention route={location.pathname === path ? route : null} active={location.pathname === path ? {id:tab.id} : null} tabs={[tab]} ready renderRoute={body => body} />;
  }
  const root = createRootRoute({ component: Root });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path, component: Tool }),
      createRoute({ getParentRoute: () => root, path: "/" }),
    ]),
    history: createMemoryHistory({ initialEntries: [`${path}?${query}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(held?.current()).toBe(true));
  const original = held;
  expect(held!.address.read().toString()).toBe(query.toString());
  await act(() => router.navigate({ to: "/" }));
  // The hidden tree must retain all four inputs, before target/Work re-admission can run.
  expect(held!.address.read().toString()).toBe(query.toString());
  await act(() => router.navigate({ href: `${path}?${query}` }));
  await waitFor(() => expect(held!.current()).toBe(true));
  expect(held).toBe(original);
  expect(held!.address.read().toString()).toBe(query.toString());
});

test("retaining the tools index selects its leaf rather than the root with the same full path", async () => {
  const root = createRootRoute({ component: () => <output>root shell</output> });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <output>tools index</output>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const view = render(
    <RouterContextProvider router={router}>
      <RouteRetention
        route="home"
        active={null}
        tabs={[]}
        ready={false}
        renderRoute={(body) => body}
      />
    </RouterContextProvider>,
  );
  expect(view.getByText("tools index")).toBeTruthy();
  expect(view.queryByText("root shell")).toBeNull();
});
test("an untabbed route keeps custody across its own history push, before the bank re-renders", async () => {
  let scope: RouteActivityScope | null = null;
  function Capture() {
    scope = useRouteActivity();
    return null;
  }
  function Root() {
    const location = useRouterState({ select: (state) => state.location });
    return (
      <RouteRetention
        route={location.pathname === "/ducts" ? "ducts" : null}
        active={null}
        tabs={[]}
        ready
        renderRoute={(body) => body}
      />
    );
  }
  const root = createRootRoute({ component: Root });
  const ducts = createRoute({ getParentRoute: () => root, path: "/ducts", component: Capture });
  const router = createRouter({
    routeTree: root.addChildren([ducts]),
    history: createMemoryHistory({ initialEntries: ["/ducts?selected=1"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(scope?.current()).toBe(true));
  // The route's address port pushes; history updates synchronously, the bank re-renders later.
  router.history.push("/ducts?selected=2");
  expect(scope!.current()).toBe(true);
});
