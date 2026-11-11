// @vitest-environment jsdom
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, afterEach, expect, test, vi } from "vite-plus/test";
import { Route as builtinRoute } from "../routes/$route";
import { getRouter } from "../router";

vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});
beforeEach(() => vi.stubGlobal("scrollTo", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

test.each([
  [
    "?target=%20session-1%20&work=%20W%20&thread=%20T%20",
    { target: " session-1 ", work: " W ", thread: " T " },
  ],
  // `?target` is codec text (address-transport `searchCodec`): the router never JSON-parses it.
  ["?target=123&work=false&thread=%20%20", {target:"123",work:false,thread:"  "}],
  ["?target=%7B%22kind%22%3A%22open%22%7D", { target: '{"kind":"open"}' }],
])("kernel routes coexist with file routes and preserve raw search for the typed owner: %s", async (query, expected) => {
  const router = getRouter();
  router.update({ history: createMemoryHistory({ initialEntries: [`/duct-loss${query}`] }) });
  await router.load();
  const match = router.state.matches.find((entry) => entry.routeId === "/$route");
  expect(match?.status).toBe("success");
  expect(
    Object.fromEntries(
      Object.entries(match?._strictSearch ?? {}).filter(([key]) =>
        ["target", "work", "thread"].includes(key),
      ),
    ),
  ).toEqual(expected);
  expect(match?.params).toEqual({ route: "duct-loss" });
  expect(router.routesByPath["/$route"]).toBe(builtinRoute);
  expect(router.routesByPath["/tool/$key"]).toBeDefined();
  expect(router.buildLocation({ to: "/$route", params: { route: "duct-loss" }, search: { work: "W" } }).pathname).toBe(
    "/duct-loss",
  );
  expect(Reflect.get(router.routesByPath, "/shell-probe")).toBeUndefined();
});
