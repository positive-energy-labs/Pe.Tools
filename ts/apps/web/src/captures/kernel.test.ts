import { placeInput } from "../shell/admitted-place.test-fixture";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { admitCaptures } from "./admission";
import { createRouteShell } from "../shell/admitted-mount";
import { sourceRouteServices } from "../shell/source-route-services";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

function location(search: Record<string, string> = {}) {
  let current = new URLSearchParams(search);
  const listeners = new Set<() => void>();
  return {
    read: () => current,
    write: (value: URLSearchParams) => {
      current = value;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate: (search: Record<string, string>) => {
      current = new URLSearchParams(search);
      listeners.forEach((listener) => listener());
    },
  };
}
import { captureId } from "./kernel";
import { mountAdmittedRoute } from "../shell/admitted-mount";
import type { UseSource } from "../shell/readings";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
});
const source: UseSource = {
  kind: "use",
  open: (_, deliver) => deliver({ kind: "complete", value: [], revision: 1 }),
};
test("the source-imported builtin mounts, restores subject and selection together, and retires", async () => {
  const route = await admitCaptures();
  const selected = [{ kind: "capture", id: captureId("second") }];
  const address = location({
    sha: captureId("first"),
    selected: JSON.stringify(selected),
    open: JSON.stringify({ kind: "ids", ids: ["second"] }),
  });
  const mounted = createRouteShell(sourceRouteServices({ "captures.list": source })).mount(
    route,
    placeInput(address),
  );
  cleanups.push(() => mounted.close());
  expect(mounted.page.read()).toMatchObject({
    sha: captureId("first"),
    selected,
    open: { kind: "ids", ids: ["second"] },
  });
  expect(renderToStaticMarkup(mounted.read("captures") as ReactNode)).toContain(
    "no captures kept yet",
  );
  expect(mounted.page.select([]).kind).not.toBe("refused");
  address.navigate({ sha: "legacy-sha", open: "legacy-sha" });
  expect(mounted.page.read()).toMatchObject({
    sha: captureId("legacy-sha"),
    selected: [],
    open: { kind: "ids", ids: ["legacy-sha"] },
  });
  mounted.close();
  expect(() => mounted.read("captures")).toThrow(/admission/);
});
test("a stale stamp or copied handle cannot mount", async () => {
  const route = await admitCaptures();
  expect(() => mountAdmittedRoute(route, "0".repeat(64))).toThrow(/Stale/);
  // @ts-expect-error reconstructed handles lack A's private authority
  const copied: typeof route = { data: route.data, fingerprint: route.fingerprint };
  expect(() => mountAdmittedRoute(copied, route.fingerprint)).toThrow(/admission/);
});

test("admitted tables cannot replace bodies or schemas after source admission", async () => {
  const route = await admitCaptures();
  const mounted = createRouteShell(sourceRouteServices({ "captures.list": source })).mount(
    route,
    placeInput(location()),
  );
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(route);
  cleanups.push(() => registration.deactivate());
  const bindings = resolveRouteBindings(registry, route)!;
  cleanups.push(() => mounted.close());
  expect(() =>
    Object.defineProperty(bindings.bodies.main!, "run", { value: () => null }),
  ).toThrow();
  expect(() => Object.defineProperty(bindings.schemas, "subject", { value: null })).toThrow();
  expect(renderToStaticMarkup(mounted.read("captures") as ReactNode)).toContain(
    "no captures kept yet",
  );
});

test.each(["browse", "", "unknown"])("fixture %s never reaches the host", async (fixture) => {
  const route = await admitCaptures();
  const open = vi.fn(() => {
    throw Error("Native fallback");
  });
  const mounted = createRouteShell(
    sourceRouteServices({ "captures.list": { kind: "use", open } }),
  ).mount(route, placeInput(location({ fixture })));
  cleanups.push(() => mounted.close());
  const html = renderToStaticMarkup(mounted.read("captures") as ReactNode);
  expect(html.includes("Ground plan")).toBe(fixture === "browse");
  mounted.refresh();
  expect(open).not.toHaveBeenCalled();
});
