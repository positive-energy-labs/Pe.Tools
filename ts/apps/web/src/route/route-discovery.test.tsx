// @vitest-environment jsdom
import { beforeAll, expect, test, vi } from "vite-plus/test";
import { builtinRouteKeys } from "./builtin-inventory";
import { publicRoutes, publicRoutesReady } from "./builtin-routes";
import { legacyRouteDiscovery } from "../shell/legacy-route-door";
import { hostedRouteAddress } from "../workbench/hosted-route";
import { actionRoute, capturedPlace } from "../workbench/chat-plugins";
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
beforeAll(() => publicRoutesReady);
test("every builtin is discoverable once with its native or admitted authority and a hosted mount", () => {
  for (const key of builtinRouteKeys) {
    const entries = publicRoutes.entries().filter(({ manifest }) => manifest.key === key);
    expect(entries, key).toHaveLength(1);
    if (key === "fans" || key === "ducts") {
      const registered = publicRoutes.byAddress(`/${key}`);
      expect(registered && "typed" in registered && registered.typed.spec.key).toBe(key);
      expect(entries[0]!.admitted).toBeUndefined();
    } else expect(entries[0]!.admitted?.data.key).toBe(key);
    expect(publicRoutes.declaration(key)?.key).toBe(key);
    expect(entries[0]!.graph).toBeUndefined();
    expect(entries[0]!.hosted).toBeTypeOf("function");
    expect(legacyRouteDiscovery.get(key)).toBeUndefined();
  }
  for (const key of legacyRouteDiscovery.keys())
    expect(publicRoutes.get(key)?.graph).toBe(legacyRouteDiscovery.get(key)!.graph);
  // Q2: fans now owns its canonical Work registration.
  expect(publicRoutes.get("fans")!.work!.route).toBe("fans");
  expect(actionRoute("families.apply")).toBe("families");
});
test("hosted admitted address retains the call's exact Work, target and thread without global URL writes", () => {
  const route = publicRoutes.get("families")!.admitted!;
  const target = JSON.stringify({ kind: "open", ref: { session: "original", openId: "one" } });
  const address = hostedRouteAddress(route, {
    thread: "caller",
    target,
    work: "recorded",
    visible: true,
  });
  const notify = vi.fn();
  const stop = address.subscribe(notify);
  address.write(new URLSearchParams({ focus: "cell", target: "replacement" }), "push");
  expect(Object.fromEntries(address.read())).toEqual({
    focus: "cell",
    thread: "caller",
    target,
    work: "recorded",
  });
  expect(notify).toHaveBeenCalledOnce();
  stop();
  expect(
    capturedPlace(
      "families",
      {
        binding: "open",
        route: "families",
        target: null,
        open: { session: "original", openId: "one" },
      },
      {},
      undefined,
      false,
    ),
  ).toMatchObject({ ok: true, route: "families", carry: { target } });
});

test("Schedules' hosted workspace uses its admitted subject codec without changing Work identity", () => {
  const route = publicRoutes.get("schedules")!.admitted!;
  const address = hostedRouteAddress(route, {
    thread: "caller",
    work: "schedule-42",
    visible: true,
  });
  expect(address.read().get("workspaceId")).toBe('["schedules","schedule-42"]');
  expect(address.read().get("work")).toBe("schedule-42");
});
