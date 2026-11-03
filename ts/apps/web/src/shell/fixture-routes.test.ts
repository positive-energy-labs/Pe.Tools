import { afterEach, expect, test, vi } from "vite-plus/test";
import { routeDirectory } from "../../../../packages/agent-contracts/src/generated/route-directory";
import { admitCaptures } from "../captures/admission";
import { createRouteShell } from "./admitted-mount";
import { sourceRouteServices } from "./source-route-services";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { createFixtureMount } from "./fixture";
import { legacyGraphs as routes } from "../legacy-test-inventory.test-support";
import { builtinAdmission, legacyBuiltinKeys } from "./legacy-route-door";
import { publicRoutes } from "../route/builtin-routes";
import { podsGraph } from "../pods/graph";
import { podsBinding } from "../pods/actions";
import { ductLossGraph } from "../duct-loss/graph";
import { chatGraph } from "../chat/graph";

afterEach(() => vi.unstubAllGlobals());
test.each(routeDirectory.map((entry) => [entry.directory.path, entry.key] as const))(
  "%s mounts every declared seed through the kernel without host reads",
  async (_, key) => {
    if (key === "captures") {
      const route = await admitCaptures();
      const open = vi.fn(() => {
        throw Error("Real host called");
      });
      const mounted = createRouteShell(
        sourceRouteServices({ "captures.list": { kind: "use", open } }),
      ).mount(route, {
        read: () => new URLSearchParams({ fixture: "browse" }),
        write: () => {},
        subscribe: () => () => {},
      });
      try {
        expect(renderToStaticMarkup(mounted.read("captures") as ReactNode)).toContain(
          "Ground plan",
        );
        mounted.refresh();
        expect(open).not.toHaveBeenCalled();
      } finally {
        mounted.close();
      }
      return;
    }
    if (key === "families") {
      const { admitFamilies } = await import("../families/route");
      const mount = createRouteShell(sourceRouteServices({})).mount(await admitFamilies(), {
        read: () => new URLSearchParams({ fixture: "audit" }),
        write() {},
        subscribe: () => () => {},
      });
      try {
        expect(isValidElement(mount.read("main"))).toBe(true);
        expect(mount.work()).not.toBeNull();
      } finally {
        mount.close();
      }
      return;
    }
    if (key === "schedules") {
      const { admitSchedules } = await import("../schedules/route");
      const { scheduleIdentity } = await import("../schedules/neutral");
      const mount = createRouteShell(
        sourceRouteServices(
          {},
          {
            target: () => ({ kind: "document", ref: { session: "fixture", openId: "schedules" } }),
          },
        ),
      ).mount(await admitSchedules(), {
        read: () =>
          new URLSearchParams({
            fixture: "read",
            workspaceId: scheduleIdentity("schedule:fixture"),
          }),
        write() {},
        subscribe: () => () => {},
      });
      try {
        // The grid owns DOM portals; schedules/kernel.test.tsx renders it under jsdom.
        expect(isValidElement(mount.read("grid"))).toBe(true);
        expect(mount.workBasis()?.token.scope.identity.work).toMatchObject({
          binding: "workspace",
          work: "schedule:fixture",
        });
        expect(mount.picker("workspaceId")).toEqual([
          { id: scheduleIdentity("schedule:fixture"), label: "Mechanical equipment" },
        ]);
      } finally {
        mount.close();
      }
      return;
    }
    const graph = routes.find((graph) => graph.key === key);
    if (!graph) throw Error(`Builtin lacks fixture mount coverage: ${key}`);
    const fetch = vi.fn(() => {
      throw Error("Real host called");
    });
    vi.stubGlobal("fetch", fetch);
    expect(Object.keys(graph.seeds ?? {}).length).toBeGreaterThan(0);
    for (const name of Object.keys(graph.seeds!)) {
      for (const verb of Object.values(graph.verbs))
        if (verb.kind === "query")
          expect(
            Object.hasOwn((await graph.seeds![name]!.load()).queries ?? {}, verb.does!),
            `${graph.key}/${name}/${verb.does}`,
          ).toBe(true);
      const owner = await createFixtureMount(graph, name);
      const release = owner.connect();
      const demand = owner.readings.mount(Object.keys(graph.readings));
      try {
        expect(owner.snapshot().failure, name).toBeNull();
        for (const id of Object.keys(graph.readings))
          expect(
            owner.readings.get(id).status,
            `${name}/${id}: ${owner.readings.get(id).error}`,
          ).toBe("ready");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        demand();
        release();
        owner.dispose();
      }
    }
  },
);

test("Pods switches seeded members, preserves their memory Work, and undoes edits without fetch", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  const owner = await createFixtureMount(podsGraph, "browse", { binding: podsBinding });
  const release = owner.connect();
  const demand = owner.readings.mount(["member"]);
  try {
    expect(owner.readings.get("member").value).toMatchObject({ member: { pod: "mech-standards" } });
    const first = { pod: owner.view.read().page.pod, path: owner.view.read().page.path };
    const edit = await owner.control("edit", { content: '{"fixture":true}' }).run();
    expect(edit, JSON.stringify(edit)).toMatchObject({ state: "done" });
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    owner.view.setPage({ pod: "demo", path: "settings/family/box.json" });
    expect(owner.readings.get("member").value).toMatchObject({
      member: { pod: "demo", path: "settings/family/box.json" },
    });
    expect(owner.snapshot().work?.doc.fields[""]).toBeUndefined();
    owner.view.setPage(first);
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    await owner.restore("undo");
    expect(owner.snapshot().work?.doc.fields[""]).toBeUndefined();
    await owner.restore("redo");
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    demand();
    release();
    owner.dispose();
  }
});

test("calculator fixtures recalculate with Page edits rather than freezing an example", async () => {
  const owner = await createFixtureMount(ductLossGraph, "calculate");
  const disconnect = owner.connect();
  const release = owner.readings.mount(["result"]);
  try {
    const before = owner.readings.get("result").value as { loss: number };
    owner.view.setPage({ cfm: 2400 });
    const after = owner.readings.get("result").value as { loss: number };
    expect(after.loss).toBeGreaterThan(before.loss);
  } finally {
    release();
    disconnect();
    owner.dispose();
  }
});

test("companion chat stays idle and mounts its own seed beside another route", async () => {
  vi.stubGlobal("location", { pathname: "/parameter-links" });
  const owner = await createFixtureMount(
    chatGraph(() => ({ thread: "" })),
    "links",
  );
  try {
    expect(owner.snapshot().failure).toBeNull();
  } finally {
    owner.dispose();
  }
});

// Registration executes the normal builtin composition; fixture owners exercise every legacy graph.
test("every registered builtin admits without a graph hash, and the legacy door refuses unknown keys", () => {
  expect(
    publicRoutes
      .entries()
      .filter(({ graph }) => graph)
      .map(({ manifest }) => manifest.key)
      .sort(),
  ).toEqual([...legacyBuiltinKeys].sort());
  for (const {
    manifest: { key },
    graph,
  } of publicRoutes.entries()) {
    if (!graph) continue;
    expect(builtinAdmission({ ...graph, moduleHash: undefined }), key).toBeNull();
  }
  expect(builtinAdmission({ ...routes[0]!, key: "not-in-the-legacy-census" })).toContain(
    "Unenumerated legacy route",
  );
  expect(builtinAdmission({ ...routes[0]!, key: "captures" })).toContain(
    "Unenumerated legacy route",
  );
});
