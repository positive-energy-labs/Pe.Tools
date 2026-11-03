// @vitest-environment jsdom
import { Suspense } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { publicRoutes, publicRoutesReady } from "../route/builtin-routes";
import { HostedRoute } from "./hosted-route";
const seen = vi.hoisted(() => ({ props: null as any }));
vi.mock("../shell/application-route-shell", () => ({
  applicationRouteShell: (props: any) => {
    seen.props = props;
    return <output>Admitted hosted body</output>;
  },
}));
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
beforeAll(() => publicRoutesReady);
afterEach(cleanup);
test("workbench mounts the admitted registration with exact caller bindings and honors visibility", async () => {
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
  await waitFor(() => expect(screen.getByText("Admitted hosted body")).toBeTruthy());
  expect(seen.props.route).toBe(publicRoutes.get("families")!.admitted);
  expect(Object.fromEntries(seen.props.address.read())).toMatchObject({
    thread: props.thread,
    target: props.target,
    work: props.work,
  });
  rendered.rerender(
    <Suspense>
      <HostedRoute {...props} visible={false} />
    </Suspense>,
  );
  expect(screen.queryByText("Admitted hosted body")).toBeNull();
});
