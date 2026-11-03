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
// The neutral projection extracts canonical bytes; the web body derives review patches.
async function witness(aside = false, failRecovery = false, withSalvage = true) {
  const salvage = vi.fn(() => ({ ok: true as const, value: [] }));
  const data = {
    ...familiesModule.data,
    ...(withSalvage ? { salvage: "salvage" as const } : {}),
  } as const;
  const module = {
    ...familiesModule,
    data,
    bodies: {
      ...familiesModule.bodies,
      ...(withSalvage
        ? {
            salvage: {
              slot: "salvage" as const,
              kind: "salvage" as const,
              source: { module: "families/host-salvage.test.ts", export: "witness" },
              run: salvage,
            },
          }
        : {}),
    },
  };
  const recover = vi.fn((raw: unknown) => {
    if (failRecovery) throw Error("Broken recovery extractor");
    return familiesRouteState.salvage!(raw);
  });
  const hostModule = {
    ...familiesHostModule,
    data,
    bodies: {
      ...familiesHostModule.bodies,
      ...(withSalvage
        ? {
            salvage: {
              slot: "salvage" as const,
              kind: "recovery" as const,
              source: { module: "families/host-salvage.test.ts", export: "recover" },
              run: recover,
            },
          }
        : {}),
    },
  };
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
  // This fixture varies declaration presence at runtime, so use the runtime linker entry.
  const webRoute = (await webInventory.prepare("families", closure.fingerprint)).admitUnknown(
    module,
  );
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
  return { host, legacy, route: webRoute.route, salvage, recover };
}

test("admitted host enrollment preserves Families scope and excluded-name/id salvage", async () => {
  const f = await witness();
  expect(await f.legacy.salvage(key, "families")).toEqual(carried);
  expect(await f.host.salvage(key, "families")).toEqual(carried);
  const recovered = await witness(true);
  expect(await recovered.legacy.salvage(key, "families")).toEqual({ ...carried, from: "aside:1" });
  expect(await recovered.host.salvage(key, "families")).toEqual({ ...carried, from: "aside:1" });
});

test("generic mount derives a salvage review from the canonical admitted host recovery", async () => {
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
  expect(await mount.salvage()).toEqual({ kind: "review", preview: [] });
  expect(request).toHaveBeenCalledOnce();
  expect(f.recover).toHaveBeenCalledWith(raw.doc);
  expect(f.salvage).toHaveBeenCalledWith(carried.value, expect.anything());
  expect(mount.review("work.salvage")).toMatchObject({ preview: [] });
});

test("host recovery exceptions return a typed refusal for unreadable Work and newest aside", async () => {
  for (const aside of [false, true]) {
    const f = await witness(aside, true);
    expect(await f.host.salvage(key, "families")).toMatchObject({
      ok: false,
      kind: "error",
      error: "Work salvage failed: Error: Broken recovery extractor",
      hint: "Saved Work was left untouched.",
    });
  }
});

test("a route without salvage keeps recovery unavailable", async () => {
  const f = await witness(false, false, false);
  expect(await f.host.salvage(key, "families")).toBeNull();
  expect(f.recover).not.toHaveBeenCalled();
});
