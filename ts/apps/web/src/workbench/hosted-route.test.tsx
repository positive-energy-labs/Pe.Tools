// @vitest-environment jsdom
import { Suspense } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { publicRoutes, publicRoutesReady } from "../route/builtin-routes";
import { hostedRouteAddress, HostedRoute } from "./hosted-route";
const seen = vi.hoisted(() => ({ props: null as any }));
vi.mock("../shell/typed-shell", () => ({
  HostedTypedRoute: (props: any) => {
    seen.props = props;
    return props.visible ? <output>Typed hosted body</output> : null;
  },
}));
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
beforeAll(() => publicRoutesReady);
afterEach(cleanup);
test("workbench mounts the typed registration with exact caller bindings and honors visibility", async () => {
  const props = {
    route: "families",
    thread: "original-caller",
    work: "original-work",
    target: "original-target",
    visible: true,
  };
  const rendered = render(
    <Suspense>
      <HostedRoute {...props} />
    </Suspense>,
  );
  await waitFor(() => expect(screen.getByText("Typed hosted body")).toBeTruthy());
  expect(seen.props.module).toBe(publicRoutes.typed("families"));
  expect(Object.fromEntries(hostedRouteAddress(seen.props.module, seen.props).read())).toMatchObject({
    thread: props.thread,
    target: props.target,
    work: props.work,
  });
  rendered.rerender(
    <Suspense>
      <HostedRoute {...props} visible={false} />
    </Suspense>,
  );
  expect(screen.queryByText("Typed hosted body")).toBeNull();
});
