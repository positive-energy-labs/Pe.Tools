import { afterEach, expect, test, vi } from "vite-plus/test";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { familiesRouteState, bindWork } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { familiesHostModule } from "./neutral";
import { familiesModule } from "./kernel";
import { createRouteShell } from "../shell/admitted-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { sourceRouteServices } from "../shell/source-route-services";
import * as workHost from "../route/host";

const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Magna3 - Mechanical Equipment"],
  placementScope: "AllLoaded" as const,
};
const key = bindWork("families", null);
const raw = {
  version: 1,
  schemaVersion: 1,
  revision: 7,
  doc: { scope: filter, excluded: { "Magna3 - Mechanical Equipment": {}, "10826118": {} } },
};
const carried = {
  from: "unreadable",
  value: { scope: filter, familyNames: ["Magna3 - Mechanical Equipment"], familyIds: [10826118] },
};
const closes: (() => void)[] = [];
afterEach(() => {
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.restoreAllMocks();
});

// This fixture declares the web salvage slot, so an absent declaration cannot explain null.
// Host projection accepts it but exposes only migrations to RouteWorkspace.registerAdmitted.
async function witness(aside = false) {
  const salvage = vi.fn(() => ({ ok: true as const, value: [] }));
  const data = { ...familiesModule.data, salvage: "salvage" } as const;
  const module = {
    ...familiesModule,
    data,
    bodies: {
      ...familiesModule.bodies,
      salvage: {
        slot: "salvage" as const,
        kind: "salvage" as const,
        source: { module: "families/host-salvage.test.ts", export: "witness" },
        run: salvage,
      },
    },
  };
  const hostModule = { ...familiesHostModule, data };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data,
    hostVersion: "w2d-witness",
    variants: [{ client: "web" as const, entry: "families/kernel.ts" }],
    modules: [{ id: "families/kernel.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const closure = { envelope, fingerprint: await builtinClosureFingerprint(envelope) };
  const hostInventory = createBuiltinRouteInventory({
    families: { host: true, module: hostModule, closure, catalog: [] },
  });
  const hostRoute = (await hostInventory.prepare("families", closure.fingerprint)).admitHost(
    hostModule,
  );
  if (!hostRoute.ok) throw Error(JSON.stringify(hostRoute.diagnostics));
  const webInventory = createBuiltinRouteInventory({
    families: {
      module,
      closure,
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const webRoute = (await webInventory.prepare("families", closure.fingerprint)).admit(module);
  if (!webRoute.ok) throw Error(JSON.stringify(webRoute.diagnostics));
  const workspace = (legacy: boolean) => {
    const saved = new Map<string, unknown>(
      aside
        ? [
            [
              "families",
              {
                version: 1,
                schemaVersion: 1,
                revision: 8,
                doc: familiesRouteState.schema.parse({}),
              },
            ],
            ["families:aside:1", structuredClone(raw)],
          ]
        : [["families", structuredClone(raw)]],
    );
    return new RouteWorkspace({
      registrations: legacy ? [{ spec: familiesRouteState }] : [],
      store: {
        getState: async ({ route }) => saved.get(route),
        setState: async ({ route, value }) => {
          saved.set(route, structuredClone(value));
        },
      },
    });
  };
  const legacy = workspace(true);
  const host = workspace(false);
  const registration = host.registerAdmitted(hostRoute.route);
  closes.push(() => registration.close());
  expect(await registration.ready).toBeNull();
  expect(
    await host.admitFeed(key, {
      routeKey: "families",
      fingerprint: hostRoute.route.workFingerprint,
    }),
  ).toBeNull();
  return { host, legacy, route: webRoute.route, salvage };
}

test("kernel gap: admitted host enrollment loses Families scope and excluded-name/id salvage", async () => {
  const f = await witness();
  expect(await f.legacy.salvage(key, "families")).toEqual(carried);
  expect(await f.host.salvage(key, "families")).toBeNull();
  const recovered = await witness(true);
  expect(await recovered.legacy.salvage(key, "families")).toEqual({ ...carried, from: "aside:1" });
  expect(await recovered.host.salvage(key, "families")).toBeNull();
});

test("kernel gap: generic mount cannot offer carry-over when the real admitted host returns null", async () => {
  const f = await witness(true);
  const request = vi
    .spyOn(workHost, "salvageRouteWork")
    .mockImplementation(
      (work) => f.host.salvage(work, "families") as ReturnType<typeof workHost.salvageRouteWork>,
    );
  const observe = observeResources(f.host, { observe: () => () => {} });
  const work = createWorkFeedClient(
    { subscribe: observe, dirty() {} },
    {
      write: (key, write) => f.host.write(key, "families", "human", write),
      submit: async () => {
        throw Error("Unexpected native dispatch");
      },
    },
  );
  const mount = createRouteShell({
    ...sourceRouteServices({}),
    work,
  }).mount(f.route, {
    read: () => new URLSearchParams(),
    write() {},
    subscribe: () => () => {},
  });
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  expect(await mount.salvage()).toBeNull();
  expect(request).toHaveBeenCalledOnce();
  expect(f.salvage).not.toHaveBeenCalled();
  expect(mount.review("work.salvage")).toBeNull();
});
