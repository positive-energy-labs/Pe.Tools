// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ductLossRoute } from "../duct-loss/route";
import { getRouter } from "../router";
import { publicRoutes } from "./builtin-routes";
import { ShellProbeRoute, shellProbe } from "./shell-probe";

// Exercise the real app tree and registry without host-dependent root chrome.
vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});

beforeEach(() => vi.stubGlobal("scrollTo", vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([
  [
    "?target=%20session-1%20&work=%20W%20&thread=%20T%20",
    { target: "session-1", work: "W", thread: "T" },
    { target: "session-1", work: "W", thread: "T" },
  ],
  ["?target=123&work=false&thread=%20%20", {}, { target: 123, work: false, thread: "  " }],
  [
    "?target=%7B%22kind%22%3A%22open%22%7D",
    { target: '{"kind":"open"}' },
    { target: '{"kind":"open"}' },
  ],
])(
  "the app mounts the manifest route and validates routeSearch: %s",
  async (query, expected, merged) => {
    const router = getRouter();
    router.update({
      history: createMemoryHistory({ initialEntries: [`/shell-probe${query}`] }),
    });
    await act(async () => {
      await router.load();
    });
    const view = render(createElement(RouterProvider, { router }));
    expect((await view.findByLabelText("Shell probe")).textContent).toBe(JSON.stringify(merged));
    const match = router.state.matches.find((entry) => entry.routeId === "/shell-probe");
    expect(match?.status).toBe("success");
    expect(match?._strictSearch).toEqual(expected);
    // TanStack merges validation into the input; omitted invalid keys remain in loose search.
    expect(match?.search).toEqual(merged);
    expect(router.routesByPath["/shell-probe"]).toBe(ShellProbeRoute);
    expect(router.routesByPath["/duct-loss"]).toBe(ductLossRoute);
    expect(router.routesByPath["/tool/$key"]).toBeDefined();
    expect(router.buildLocation({ to: "/shell-probe", search: { work: "W" } }).pathname).toBe(
      "/shell-probe",
    );
    expect(publicRoutes.get(shellProbe.manifest.key)?.manifest).toBe(shellProbe.manifest);
    expect(
      publicRoutes.entries().map(({ manifest }) => ({ key: manifest.key, name: manifest.name })),
    ).toContainEqual({ key: "shell-probe", name: "Shell probe" });
    expect(publicRoutes.get("ducts")).toBeDefined();
  },
);
