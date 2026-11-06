import { placeInput } from "../shell/admitted-place.test-fixture";
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
  const salvage = vi.fn((value: unknown) => ({
    ok: true as const,
    value: aside
      ? []
      : [
          { path: ["scope"], value: { edit: { value: (value as typeof carried.value).scope } } },
          {
            path: ["excluded"],
            value: Object.fromEntries(
              [
                ...(value as typeof carried.value).familyNames,
                ...(value as typeof carried.value).familyIds.map((id) => {
                  if (id !== 10826118) throw Error("Unknown fixture family id");
                  return "Magna3 - Mechanical Equipment";
                }),
              ].map((id) => [String(id), { by: "human" }]),
            ),
          },
        ],
  }));
  const { salvage: _oldSalvage, ...plainData } = familiesModule.data;
  const { salvage: _oldBody, ...plainBodies } = familiesModule.bodies;
  const data = {
    ...plainData,
    ...(withSalvage ? { salvage: "salvage" as const } : {}),
  } as const;
  const module = {
    ...familiesModule,
    data,
    bodies: {
      ...plainBodies,
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
  const { salvage: _hostRecovery, ...plainHostBodies } = familiesHostModule.bodies;
  const hostModule = {
    ...familiesHostModule,
    workState: { ...familiesRouteState, salvage: withSalvage ? recover : undefined },
    data,
    bodies: {
      ...plainHostBodies,
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
  let hostSaved: Map<string, unknown>;
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
    if (!legacy) hostSaved = saved;
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
  return { host, legacy, route: webRoute.route, salvage, recover, saved: hostSaved! };
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
  }).mount(
    f.route,
    placeInput({
      read: () => new URLSearchParams(),
      write() {},
      subscribe: () => () => {},
    }),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  await vi.waitFor(() => expect(mount.recovery().carryOver).toBe(true));
  expect(await mount.salvage()).toEqual({ kind: "review", preview: [] });
  expect(request).toHaveBeenCalled();
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

// A complete neutral spec does not supply the missing admitted recovery lifecycle port.
test("unreadable admitted Work starts fresh, preserves its aside and accepts carry-over", async () => {
  const f = await recoveryMount();
  const { mount } = f;
  await vi.waitFor(() => expect(mount.workProblem()).not.toBeNull());
  expect(mount.work()).toBeNull();
  expect(await f.host.salvage(key, "families")).toEqual(carried);
  expect(mount.recovery()).toMatchObject({
    startFresh: true,
    carryOver: false,
    sentence: mount.workProblem(),
  });
  await mount.startFresh();
  expect(f.saved.get("families:aside:1")).toEqual(raw);
  expect(f.salvage).toHaveBeenCalledWith(carried.value, expect.anything());
  expect(mount.review("work.salvage")).toMatchObject({ stale: false });
  const outcome = mount.confirm(
    "work.salvage",
  ) as import("../../../../packages/agent-contracts/src/work-journal-door").Observation<
    import("../../../../packages/agent-contracts/src/work-journal-door").WorkWriteOutcome
  >;
  await new Promise<void>((resolve) =>
    outcome.subscribe(
      (state) => {
        if (state.kind !== "pending") {
          expect(state.kind).toBe("accepted");
          resolve();
        }
      },
      () => {},
    ),
  );
  expect(mount.work()?.value).toMatchObject({
    scope: { edit: { value: filter } },
    excluded: { "Magna3 - Mechanical Equipment": { by: "human" } },
  });
});

async function recoveryMount(withSalvage = true, stale = false) {
  const f = await witness(false, false, withSalvage);
  vi.spyOn(workHost, "startFreshRouteWork").mockImplementation((key) =>
    f.host.startFresh(key, "families", "human"),
  );
  vi.spyOn(workHost, "salvageRouteWork").mockImplementation(
    (key) => f.host.salvage(key, "families") as ReturnType<typeof workHost.salvageRouteWork>,
  );
  const observe = observeResources(f.host, { observe: () => () => {} });
  const door = createWorkFeedClient(
    { subscribe: observe, dirty() {} },
    {
      write: (key, write) => f.host.write(key, "families", "human", write),
      submit: async () => {
        throw Error("Unexpected native dispatch");
      },
    },
  );
  let opens = 0;
  const open = vi.fn((scope: Parameters<typeof door.open>[0]) => {
    opens++;
    return door.open(
      stale && opens > 1
        ? {
            ...scope,
            fingerprint: (scope.fingerprint.slice(0, -1) +
              (scope.fingerprint.endsWith("a") ? "b" : "a")) as typeof scope.fingerprint,
          }
        : scope,
    );
  });
  const mount = createRouteShell({ ...sourceRouteServices({}), work: { ...door, open } }).mount(
    f.route,
    placeInput({
      read: () => new URLSearchParams(),
      write() {},
      subscribe: () => () => {},
    }),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.recovery().startFresh).toBe(true));
  return { ...f, mount, open };
}

test("a route without salvage starts fresh without a carry-over review", async () => {
  const f = await recoveryMount(false);
  await f.mount.startFresh();
  expect(f.mount.work()).not.toBeNull();
  expect(f.mount.recovery().carryOver).toBe(false);
  expect(f.mount.review("work.salvage")).toBeNull();
  expect(f.saved.get("families:aside:1")).toEqual(raw);
  expect(f.recover).not.toHaveBeenCalled();
  expect(f.open.mock.calls[1]![0]).toEqual(f.open.mock.calls[0]![0]);
});

test("a stale registration on the re-acquired feed refuses carry-over", async () => {
  const f = await recoveryMount(true, true);
  await expect(f.mount.startFresh()).rejects.toThrow("Route bytes differ");
  expect(f.mount.workFailure()?.kind).toBe("registration-mismatch");
  expect(f.mount.review("work.salvage")).toBeNull();
  expect(f.mount.recovery().carryOver).toBe(false);
  expect(f.saved.get("families:aside:1")).toEqual(raw);
});
