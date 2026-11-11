// @vitest-environment jsdom
import { subjectCode } from "@pe/agent-contracts";
import { expect, test, vi } from "vite-plus/test";
import { routeRegistry } from "./registry";
import { publicRoutes } from "./builtin-routes";
import { hostedRouteAddress } from "../workbench/hosted-route";
import { actionRoute, capturedPlace } from "../workbench/chat-plugins";
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
test("every builtin is discoverable once with its typed authority and a hosted mount", () => {
  for (const key of Object.keys(routeRegistry)) {
    const entries = publicRoutes.entries().filter(({ manifest }) => manifest.key === key);
    expect(entries, key).toHaveLength(1);
    const registered = publicRoutes.byAddress(publicRoutes.typed(key)!.data.address);
    expect(registered && "typed" in registered && registered.typed.spec.key).toBe(key);
    expect("admitted" in entries[0]!).toBe(false);
    expect(publicRoutes.declaration(key)?.key).toBe(key);
    expect("graph" in entries[0]!).toBe(false);
    expect(entries[0]!.hosted).toBeTypeOf("function");
  }
  // Q2: fans now owns its canonical Work registration.
  expect(publicRoutes.get("fans")!.work!.route).toBe("fans");
  expect(actionRoute("families.apply")).toBe("families");
});
test("hosted typed address retains the call's exact Work, target and thread without global URL writes", () => {
  const route = publicRoutes.typed("families")!;
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

test("Schedules' hosted workspace uses its typed subject codec without changing Work identity", () => {
  const route = publicRoutes.typed("schedules")!;
  const address = hostedRouteAddress(route, {
    thread: "caller",
    work: "schedule-42",
    visible: true,
  });
  expect(JSON.parse(address.read().get("workspaceId")!)).toEqual({kind:"ids",ids:[subjectCode({ keyKind: "workspace", key: "schedule-42" })]});
  expect(address.read().get("work")).toBe("schedule-42");
});
