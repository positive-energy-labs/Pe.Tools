import { placeInput } from "./admitted-place.test-fixture";
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
import { publicRoutes, publicRoutesReady } from "../route/builtin-routes";
import { ductLossGraph } from "../duct-loss/graph";
import { admitChat, createChatFixture } from "../chat/admission";

afterEach(() => vi.unstubAllGlobals());
test.each(routeDirectory.map((entry) => [entry.directory.path, entry.key] as const))(
  "%s mounts every declared seed through the kernel without host reads",
  async (_, key) => {
    if (key === "ducts") {
      const {module} = await import("../ducts/route");
      expect(module.spec.core.fixtures).toBeUndefined();
      return;
    }
    if (key === "pods") {
      const { admitPods } = await import("../pods/route");
      const mount = createRouteShell(sourceRouteServices({})).mount(
        await admitPods(),
        placeInput({
          read: () => new URLSearchParams({ fixture: "browse" }),
          write() {},
          subscribe: () => () => {},
        }),
      );
      try {
        await expect.poll(() => mount.workBasis()).not.toBeNull();
        expect(mount.readingStatus("member").snapshot.current).toBe(true);
      } finally {
        mount.close();
      }
      return;
    }
    if (key === "chat") {
      const route = await admitChat(() => ({ thread: "" }));
      const open = vi.fn(() => {
        throw Error("Real host called");
      });
      for (const fixture of Object.keys(route.data.seeds)) {
        const mount = createRouteShell(
          sourceRouteServices(
            Object.fromEntries(
              Object.keys(route.data.readings).map((id) => [id, { kind: "use", open }]),
            ),
          ),
        ).mount(
          route,
          placeInput({
            read: () => new URLSearchParams({ fixture }),
            write() {},
            subscribe: () => () => {},
          }),
        );
        try {
          for (const id of Object.keys(route.data.readings))
            expect(mount.readingStatus(id).snapshot.current, `${fixture}/${id}`).toBe(true);
          mount.refresh();
          expect(open).not.toHaveBeenCalled();
        } finally {
          mount.dispose();
        }
      }
      return;
    }
    if (key === "captures") {
      const route = await admitCaptures();
      const open = vi.fn(() => {
        throw Error("Real host called");
      });
      const mounted = createRouteShell(
        sourceRouteServices({ "captures.list": { kind: "use", open } }),
      ).mount(
        route,
        placeInput({
          read: () => new URLSearchParams({ fixture: "browse" }),
          write: () => {},
          subscribe: () => () => {},
        }),
      );
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
      const mount = createRouteShell(sourceRouteServices({})).mount(
        await admitFamilies(),
        placeInput({
          read: () => new URLSearchParams({ fixture: "audit" }),
          write() {},
          subscribe: () => () => {},
        }),
      );
      try {
        expect(isValidElement(mount.read("main"))).toBe(true);
        await expect.poll(() => mount.work()).not.toBeNull();
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
      ).mount(
        await admitSchedules(),
        placeInput(
          {
            read: () =>
              new URLSearchParams({
                fixture: "read",
                workspaceId: scheduleIdentity("schedule:fixture"),
              }),
            write() {},
            subscribe: () => () => {},
          },
          { target: { kind: "document", ref: { session: "fixture", openId: "schedules" } } },
        ),
      );
      try {
        // The grid owns DOM portals; schedules/kernel.test.tsx renders it under jsdom.
        expect(isValidElement(mount.read("grid"))).toBe(true);
        await expect
          .poll(() => mount.workBasis()?.token.scope.identity.work)
          .toMatchObject({
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
    if (key === "fans") {
      const { module } = await import("../fans/route");
      const { admit } = await import("../fans/admission.fixture");
      const { mountTypedRoute } = await import("./typed-mount");
      const { hostPresenter } = await admit();
      const fetch = vi.fn(() => { throw Error("Real host called"); });
      vi.stubGlobal("fetch",fetch);
      for(const name of Object.keys(module.spec.core.fixtures??{})) {
        const mount=mountTypedRoute(module,placeInput({read:()=>new URLSearchParams({fixture:name}),write(){},subscribe:()=>()=>{}}),hostPresenter.workFingerprint);
        try {
          await expect.poll(()=>mount.workBasis()).not.toBeNull();
          mount.page.subject({kind:"all"});
          for(const id of Object.keys(module.spec.panes)) expect(isValidElement(mount.draw(id))).toBe(true);
          mount.refresh(); expect(fetch).not.toHaveBeenCalled();
        } finally {mount.dispose();}
      }
      return;
    }
    if (key === "ducts") {
      const { loadBuiltinRoute, builtinRouteStamp } = await import("../route/builtin-inventory");
      const admitted = await loadBuiltinRoute(key, builtinRouteStamp(key));
      if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
      const route = admitted.route;
      expect(Object.keys(route.data.seeds).sort()).toEqual([
        "colours",
        "layout",
        "navigation",
        "scene",
      ]);
      const fetch = vi.fn(() => {
        throw Error("Real host called");
      });
      vi.stubGlobal("fetch", fetch);
      const services = sourceRouteServices({});
      const acquire = vi.spyOn(services.reads, "acquire");
      const subscribe = vi.spyOn(services.readings, "subscribe");
      for (const name of Object.keys(route.data.seeds)) {
        const mount = createRouteShell(services).mount(
          route,
          placeInput({
            read: () => new URLSearchParams({ fixture: name }),
            write() {},
            subscribe: () => () => {},
          }),
        );
        try {
          await expect
            .poll(() => mount.workBasis(), { message: `${key}/${name} Work` })
            .not.toBeNull();
          mount.read(route.data.subject.pane);
          // Every fixture supports the All subject, including fixtures with no matching fan rows.
          expect(mount.controls.subject({ kind: "all" }).kind).toBe("accepted");
          for (const [id, pane] of Object.entries(route.data.panes)) {
            // U4 ruling: drawn explicit-demand readings compute only after a kernel request.
            for (const reading of pane.draws)
              if (route.data.readings[reading]?.demand === "explicit") mount.refresh(reading);
            const rendered = mount.read(id);
            expect(isValidElement(rendered), `${key}/${name}/${id}`).toBe(true);
            if (
              !isValidElement<{
                ctx: { readings: Record<string, { status: string; reason?: string }> };
              }>(rendered)
            )
              throw Error("Missing admitted fixture pane");
            for (const reading of pane.draws) {
              const state = rendered.props.ctx.readings[reading];
              expect(state?.status, `${key}/${name}/${reading}: ${state?.reason}`).toBe("ready");
            }
          }
          mount.refresh();
          expect(fetch).not.toHaveBeenCalled();
          expect(acquire).not.toHaveBeenCalled();
          expect(subscribe).not.toHaveBeenCalled();
        } finally {
          mount.close();
        }
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
  const owner = await createChatFixture("links");
  try {
    expect(owner.readingStatus("transcript").snapshot.current).toBe(true);
  } finally {
    owner.dispose();
  }
});

// Registration executes the normal builtin composition; fixture owners exercise every legacy graph.
test("every registered builtin admits without a graph hash, and the legacy door refuses unknown keys", async () => {
  await publicRoutesReady;
  expect(
    publicRoutes
      .entries()
      .filter(({ graph }) => graph)
      .map(({ manifest }) => manifest.key)
      .sort(),
  ).toEqual(legacyBuiltinKeys.filter(key => key !== "pods").sort());
  expect(publicRoutes.admitted("pods")).not.toBeNull();
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
