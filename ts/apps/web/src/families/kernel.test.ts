import { placeInput } from "../shell/admitted-place.test-fixture";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { familiesModule } from "./kernel";
import { familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { admittedSources } from "../shell/admitted-sources";
import type { ReadingSource, ReadingDelivery } from "../shell/readings";
import { sourceRouteServices } from "../shell/source-route-services";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { Observation } from "../../../../packages/agent-contracts/src/work-journal-door";
const takenAt = "2026-11-02T18:13:00Z";
const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Magna3 - Mechanical Equipment"],
  placementScope: "AllLoaded" as const,
};
const document = { session: "families-w2", openId: "local-copy" };
const observation = {
  id: "w2",
  work: { binding: "open", route: "families", target: null, open: document },
  document,
  filter,
  capturedAt: takenAt,
  completedAt: takenAt,
  result: { families: [], issues: [], page: null },
};
const seed = familiesRouteState.schema.parse({ scope: { edit: { value: filter } }, takenAt });
const address = {
  familyName: "Magna3 - Mechanical Equipment",
  typeName: "Grundfos_MAGNA3 32-60 GF",
  parameter: "Amperage",
};
const key = familyCellKey(address);
const edit = { address, current: "1.01", value: { value: "1.1", storageType: "Double" as const } };
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach((close) => close()));
// Synthetic evidence proves composition only, never production source-closure enrollment.
async function admitted(sources: Record<string, ReadingSource> = {}) {
  const candidate = { ...familiesModule, sources };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: candidate.data,
    hostVersion: "fixture",
    variants: [{ client: "web" as const, entry: "families/kernel.ts" }],
    modules: [{ id: "families/kernel.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    families: {
      module: candidate,
      closure: { envelope, fingerprint },
      catalog: Object.entries(candidate.entries).map(([key, e]) => ({ key, ...e.axes, uses: [] })),
    },
  });
  const result = (await inventory.prepare("families", fingerprint)).admitUnknown(candidate);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
function settled(value: unknown): Promise<any> {
  return new Promise((resolve) =>
    (value as Observation<any>).subscribe(
      (s) => {
        if (s.kind !== "pending") resolve(s);
      },
      () => {},
    ),
  );
}
async function setup(
  application = false,
  sources: Record<string, ReadingSource> = {},
  initial = seed,
) {
  const route = await admitted(sources);
  const frames = new Map<string, (v: any) => void>();
  const requests: any[] = [];
  const store = createFixtureWorkDoor(familiesRouteState, initial);
  let workScope!: Parameters<typeof store.open>[0];
  let hostFeed!: Parameters<ReturnType<typeof store.open>["subscribe"]>[0];
  const submit = vi.fn((command: Parameters<typeof store.submit>[0]) => store.submit(command));
  const services: KernelServices = {
    ...(application
      ? sourceRouteServices(admittedSources(route))
      : {
          reads: {
            lifetime: "read" as const,
            acquire(request: any) {
              requests.push(request);
              return {
                lifetime: "read" as const,
                key: request.key,
                read: () => ({
                  status: "pending" as const,
                  current: false as const,
                  reason: "Waiting",
                }),
                release() {},
              };
            },
          },
          readings: {
            lifetime: "subscription" as const,
            subscribe(request: any, _: unknown, deliver: any) {
              frames.set(request.key.op, deliver);
              return () => {};
            },
          },
        }),
    target: () => ({ kind: "document", ref: document }),
    work: {
      ...store,
      submit,
      open(scope) {
        workScope = scope;
        return {
          subscribe(deliver, end) {
            hostFeed = deliver;
            return store.open(scope).subscribe(deliver, end);
          },
        };
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  const mount = createRouteShell(services).mount(
    route,
    placeInput(
      {
        read: () => new URLSearchParams(),
        write() {},
        subscribe: () => () => {},
      },
      { target: { kind: "document", ref: document } },
    ),
  );
  closes.push(mount.close);
  const read = () => {
    mount.invoke("read", { filter, readId: "00000000-0000-4000-8000-000000000001" });
    if (!application)
      frames.get("families.read")!({
        status: "ready",
        current: true,
        hash: "matrix",
        value: observation,
      });
  };

  return {
    mount,
    submit,
    requests,
    frames,
    read,
    store,
    scope: () => workScope,
    hostFeed: (state: Parameters<typeof hostFeed>[0]) => hostFeed(state),
  };
}
test("mounted Families edits and Revert use one accepted Work", async () => {
  const f = await setup();
  f.read();
  await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!));
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [key]: { edit: { value: edit.value } } },
  });
  await settled(f.mount.invoke("revert", key, f.mount.workBasis()!));
  expect(f.mount.work()?.value).toMatchObject({ cells: {} });
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [key]: { edit: { value: edit.value } } },
  });
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toMatchObject({ cells: {} });
  expect(f.submit).not.toHaveBeenCalled();
});
test("delayed edit preserves the rendered expectedRevision", async () => {
  const f = await setup();
  f.read();
  const basis = f.mount.workBasis()!;
  await settled(f.mount.invoke("edit", edit, basis));
  f.read();
  const result = await settled(
    f.mount.invoke("edit", { ...edit, value: { ...edit.value, value: "1.3" } }, basis),
  );
  expect(result).toMatchObject({ kind: "refused", refusal: { code: "stale_revision" } });
});
test("full Families candidate admits semantic preview and registered Stop", async () => {
  await expect(admitted()).resolves.toMatchObject({ data: { key: "families" } });
});
test("unenrolled Families source refuses rather than calling a native fallback", async () => {
  const f = await setup(true);
  f.read();
  expect(f.mount.read("main")).toMatchObject({
    props: {
      ctx: { readings: { matrix: { current: false, reason: "No source for families.read" } } },
    },
  });
  expect(() => f.mount.invoke("edit", edit, f.mount.workBasis()!)).toThrow(/Reading unavailable/);
});

// Boundary witness: do not work around shared frame loss with a route-owned executor.
test("admitted progressive Families parts stay inspectable and stale evidence refuses edits", async () => {
  let deliver!: ReadingDelivery;
  const draw = vi.spyOn(familiesModule.bodies.main, "run");
  try {
    const f = await setup(true, {
      "families.read": {
        kind: "use",
        open(ctx, publish) {
          expect(ctx.args).toMatchObject({ filter, work: observation.work, expectedRevision: 0 });
          deliver = publish;
        },
      },
    });
    f.read();
    const notified = vi.fn();
    closes.push(f.mount.subscribe(notified));
    const snapshot = () => {
      f.mount.read("main");
      return draw.mock.lastCall![0].readings.matrix;
    };
    const refusesEdit = () =>
      expect(() => f.mount.invoke("edit", edit, f.mount.workBasis()!)).toThrow(
        /Reading unavailable/,
      );
    deliver({ kind: "part", value: observation, revision: 1 });
    expect(notified).toHaveBeenCalled();
    expect(snapshot()).toMatchObject({ current: false, value: observation });
    refusesEdit();
    deliver({ kind: "complete", value: observation, revision: 2 });
    expect(snapshot()).toMatchObject({ current: true, value: observation });
    for (const kind of ["stale", "pending"] as const) {
      notified.mockClear();
      deliver({ kind });
      expect(notified).toHaveBeenCalled();
      expect(snapshot()).toMatchObject({ current: false, value: observation });
      refusesEdit();
      deliver({ kind: "complete", value: observation, revision: 3 });
      expect(snapshot()).toMatchObject({ current: true, value: observation });
    }
    deliver({ kind: "failure", error: Error("Extraction failed") });
    expect(snapshot()).toMatchObject({
      status: "failed",
      current: false,
      value: observation,
      reason: "Error: Extraction failed",
    });
    refusesEdit();
    const cancelled = { ...observation, progress: { state: "cancelled" } };
    deliver({ kind: "part", value: cancelled, revision: 4 });
    expect(snapshot()).toMatchObject({ current: false, value: cancelled });
    refusesEdit();
    deliver({ kind: "complete", value: observation, revision: 5 });
    expect(await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!))).toMatchObject({
      kind: "accepted",
    });
  } finally {
    draw.mockRestore();
  }
});

// Host call-route publishes takenAt before its completed read response. Never replace this
// with a route-local baseline writer: the real completion/feed ordering must survive.
test("host completion baseline preserves the Families read and accepts its result", async () => {
  let deliver!: ReadingDelivery;
  let released = false;
  const draw = vi.spyOn(familiesModule.bodies.main, "run");
  try {
    const f = await setup(
      true,
      {
        "families.read": {
          kind: "use",
          open(_ctx, publish) {
            deliver = publish;
            return () => {
              released = true;
            };
          },
        },
      },
      familiesRouteState.schema.parse({ scope: { edit: { value: filter } } }),
    );
    f.read();
    deliver({ kind: "part", value: observation, revision: 1 });
    // A host publication is not a human edit of the protected takenAt path.
    f.hostFeed({
      kind: "ack",
      ack: {
        key: f.scope().key,
        kind: "publish",
        by: "human",
        press: null,
        base: 0,
        revision: 1,
        undoable: false,
        patches: [{ path: ["takenAt"], value: takenAt }],
        inverse: [{ path: ["takenAt"], value: null }],
      },
    });
    expect(f.mount.work()?.value).toMatchObject({ takenAt });
    deliver({ kind: "complete", value: observation, revision: 2 });
    f.mount.read("main");
    expect(draw.mock.lastCall![0].readings.matrix).toMatchObject({
      current: true,
      status: "ready",
    });
    expect(() => f.mount.invoke("edit", edit, f.mount.workBasis()!)).not.toThrow();
    await Promise.resolve();
    expect(released).toBe(false);
  } finally {
    draw.mockRestore();
  }
});

test("staged cell edits retain the completed matrix for the next edit", async () => {
  const draw = vi.spyOn(familiesModule.bodies.main, "run");
  try {
    const f = await setup();
    f.read();
    const originalRead = f.requests.find((request) => request.key.op === "families.read");
    expect(JSON.parse(originalRead.key.sortedKeyInput).expectedRevision).toBe(0);
    expect(await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!))).toMatchObject({
      kind: "accepted",
    });
    f.mount.read("main");
    expect(draw.mock.lastCall![0].readings.matrix).toMatchObject({
      current: true,
      status: "ready",
    });
    expect(
      await settled(
        f.mount.invoke(
          "edit",
          { ...edit, value: { ...edit.value, value: "1.3" } },
          f.mount.workBasis()!,
        ),
      ),
    ).toMatchObject({ kind: "accepted" });
    expect(f.requests.filter((request) => request.key.op === "families.read")).toEqual([
      originalRead,
    ]);
    expect(JSON.parse(originalRead.key.sortedKeyInput).expectedRevision).toBe(0);
    expect(f.mount.work()?.value).toMatchObject({
      cells: { [key]: { edit: { value: { ...edit.value, value: "1.3" } } } },
    });
  } finally {
    draw.mockRestore();
  }
});
