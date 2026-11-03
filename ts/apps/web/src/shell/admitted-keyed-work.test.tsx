import { placeInput } from "./admitted-place.test-fixture";
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, scheduleGridRouteState, workWriteSchema } from "@pe/agent-contracts";
import type { WorkPatch } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as base } from "../captures/kernel";
import { createRouteShell } from "./admitted-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { sourceRouteServices } from "./source-route-services";
import { createWorkFeedClient } from "./work-feed-client";
import { admittedWorkPatches } from "./admitted-cells";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";

const spec = scheduleGridRouteState;
const seed = () =>
  spec.schema.parse({
    basis: {
      captureId: "a".repeat(64),
      stale: [
        { key: "1::1", was: "a" },
        { key: "1::2", was: "b" },
      ],
    },
    cells: { "1::1": { edit: { value: "a" } }, "1::2": { edit: { value: "b" } } },
  });
const patch = {
  path: ["cells", "1::1", "edit"],
  value: { value: "reviewed" },
} as const satisfies WorkPatch<typeof spec.schema>;
const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));
const settle = (o: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    o.subscribe(
      (v) => {
        if (v.kind !== "pending") resolve(v);
      },
      () => {},
    ),
  );

async function fixture(connected = false) {
  const key = `u8p-${crypto.randomUUID()}`;
  const module = {
    ...base,
    data: {
      ...base.data,
      key,
      address: "/u8p",
      capabilities: ["work"] as const,
      work: { route: key, schema: "work", version: 1, migrations: {} },
      verbs: {
        edit: {
          kind: "work" as const,
          input: "edit",
          label: "Edit",
          review: "none" as const,
          deps: { page: [], work: ["cells"], readings: [] },
          captures: [],
          patches: "edit",
        },
      },
    },
    schemas: {
      ...base.schemas,
      work: spec.schema,
      edit: z.custom<readonly WorkPatch<typeof spec.schema>[]>(),
    },
    bodies: {
      ...base.bodies,
      edit: {
        slot: "verbs.edit.patches",
        kind: "work" as const,
        source: { module: "shell/admitted-keyed-work.test.tsx", export: "fixture" },
        run: (_ctx: unknown, patches: readonly WorkPatch<typeof spec.schema>[]) => patches,
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "u8p",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    witness: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admitted = (await inventory.prepare("witness", fingerprint)).admitUnknown(module);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const store = createFixtureWorkDoor(spec, seed());
  const reconcile = vi.fn(spec.reconcileEdit);
  const persisted = new Map<string, unknown>();
  const host = new RouteWorkspace({
    registrations: [{ spec: { ...spec, route: key, reconcileEdit: reconcile } }],
    store: {
      getState: async ({ targetKey }) =>
        persisted.get(targetKey) ?? { version: 1, revision: 0, doc: seed() },
      setState: async ({ targetKey, value }) => {
        persisted.set(targetKey, structuredClone(value));
      },
    },
  });
  const transport = createWorkFeedClient(undefined, {
    write: async (scope, write) =>
      host.write(scope, key, "human", workWriteSchema.parse(JSON.parse(JSON.stringify(write)))),
    submit: async () => {
      throw Error("Unexpected native command");
    },
  });
  const door = {
    ...store,
    submitWork: vi.fn((...args: Parameters<typeof store.submitWork>) =>
      connected ? transport.submitWork(...args) : store.submitWork(...args),
    ),
  };
  const mount = createRouteShell({ ...sourceRouteServices({}), work: door }).mount(
    admitted.route,
    placeInput({
      read: () => new URLSearchParams(),
      write() {},
      subscribe: () => () => {},
    }),
  );
  stops.push(mount.close);
  const edit = (patches: unknown, basis = mount.workBasis()!) =>
    settle(mount.invoke("edit", patches, basis) as Observation<WorkWriteOutcome>);
  return { mount, door, edit, module, reconcile };
}

test("G3 flipped: admitted keyed edit keeps the untouched cell stale through the real schedule reducer", async () => {
  const f = await fixture();
  const result = await f.edit([patch]);
  expect(result.kind).toBe("accepted");
  expect(f.door.submitWork.mock.calls[0]![1].patches).toEqual([patch]);
  expect(f.mount.work()?.revision).toBe(1);
  expect(spec.schema.parse(f.mount.work()?.value).basis?.stale).toEqual([
    { key: "1::2", was: "b" },
  ]);
});
test("keyed delete uses the existing Work door delete spelling and retains unrelated stale marks", async () => {
  const f = await fixture();
  expect((await f.edit([{ path: ["cells", "1::1"], op: "delete" }])).kind).toBe("accepted");
  expect(f.door.submitWork.mock.calls[0]![1].patches).toEqual([{ path: ["cells", "1::1"] }]);
  const doc = spec.schema.parse(f.mount.work()?.value);
  expect(doc.cells["1::1"]).toBeUndefined();
  expect(doc.cells["1::2"]).toEqual(seed().cells["1::2"]);
  expect(doc.basis?.stale).toEqual([{ key: "1::2", was: "b" }]);
});
test("undo and redo of one keyed edit preserve the other cell exactly", async () => {
  const f = await fixture();
  const before = f.mount.work()?.value;
  const result = await f.edit([patch]);
  if (result.kind !== "accepted") throw Error("edit refused");
  expect(
    result.ack.inverse.filter((p) => p.path[0] === "cells").every((p) => p.path[1] === "1::1"),
  ).toBe(true);
  const edited = f.mount.work()?.value;
  expect((await f.mount.history!.undo()).ok).toBe(true);
  expect(f.mount.work()?.value).toEqual(before);
  expect((await f.mount.history!.redo()).ok).toBe(true);
  expect(f.mount.work()?.value).toEqual(edited);
});
test("one accepted revision applies multiple keyed patches and a stale basis refuses", async () => {
  const f = await fixture();
  const basis = f.mount.workBasis()!;
  expect(
    (await f.edit([patch, { path: ["cells", "1::3"], value: { edit: { value: "c" } } }], basis))
      .kind,
  ).toBe("accepted");
  expect(f.mount.work()?.revision).toBe(1);
  const before = f.mount.work();
  expect(await f.edit([patch], basis)).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision" },
  });
  expect(f.mount.work()).toEqual(before);
});
test("top-level patches retain their old meaning and paths", async () => {
  const f = await fixture();
  const root = { path: ["cells"], value: seed().cells };
  expect((await f.edit([root])).kind).toBe("accepted");
  expect(f.door.submitWork.mock.calls[0]![1].patches).toEqual([root]);
  expect(spec.schema.parse(f.mount.work()?.value).basis?.stale).toBeUndefined();
});
test("untyped Work results cannot bypass path, key, leaf or value checks", async () => {
  const { module } = await fixture();
  for (const invalid of [
    { path: ["missing"], value: {} },
    { path: ["cells", "1::1", "missing"], value: 2 },
    { path: ["takenAt", "x"], op: "delete" },
    { path: ["cells", "1::1", "edit"], value: { value: {} } },
    { path: ["cells", "__proto__"], op: "delete" },
    { path: ["cells", "1::1"], op: "delete", value: {} },
  ])
    expect(() => admittedWorkPatches(module.data, module.schemas, [invalid])).toThrow();
});
test("W3b direct witness: keyed edit preserves the second stale mark while root replacement clears it", () => {
  const envelope = { version: 1 as const, revision: 0, doc: seed() };
  const direct = applyPatches(
    spec,
    envelope,
    "human",
    [{ path: [...patch.path], value: patch.value }],
    0,
  );
  if (!direct.ok) throw Error("refused");
  expect(direct.envelope.doc.basis?.stale).toEqual([{ key: "1::2", was: "b" }]);
});

test("host RouteWorkspace applies the same keyed path in one revision and refuses stale writes", async () => {
  const state = new Map<string, unknown>([["schedules", { version: 1, revision: 0, doc: seed() }]]);
  const reconcile = vi.fn(spec.reconcileEdit);
  const host = new RouteWorkspace({
    registrations: [{ spec: { ...spec, reconcileEdit: reconcile } }],
    store: {
      getState: async ({ route }) => state.get(route),
      setState: async ({ route, value }) => {
        state.set(route, structuredClone(value));
      },
    },
  });
  const key = {
    binding: "workspace" as const,
    target: null,
    route: "schedules",
    work: `u8p-${crypto.randomUUID()}`,
  };
  const before = await host.read(key, "schedules");
  const input = workWriteSchema.parse({
    patches: [patch],
    expectedRevision: before!.revision,
    press: "u8p-edit",
  });
  const result = await host.write(key, "schedules", "human", input);
  if (!result.ok) throw Error(JSON.stringify(result));
  expect(result.revision).toBe(before!.revision + 1);
  expect(reconcile.mock.calls[0]![1]).toEqual([patch]);
  const doc = spec.schema.parse((await host.read(key, "schedules"))!.doc);
  expect(doc.basis?.stale).toEqual([{ key: "1::2", was: "b" }]);
  expect(
    await host.write(key, "schedules", "human", { ...input, press: "u8p-stale" }),
  ).toMatchObject({ ok: false, code: "stale_revision" });
  const deleted = await host.write(
    key,
    "schedules",
    "human",
    workWriteSchema.parse({
      patches: [{ path: ["cells", "1::1"] }],
      expectedRevision: result.revision,
      press: "u8p-delete",
    }),
  );
  if (!deleted.ok) throw Error(JSON.stringify(deleted));
  expect(deleted.write.inverse.filter((p) => p.path[0] === "cells").map((p) => p.path)).toEqual([
    ["cells", "1::1"],
  ]);
  const restored = await host.write(key, "schedules", "human", {
    kind: "restore",
    press: null,
    expectedRevision: deleted.revision,
    restoreOf: deleted.revision,
    patches: deleted.write.inverse,
  });
  expect(restored.ok).toBe(true);
  expect(spec.schema.parse((await host.read(key, "schedules"))!.doc)).toEqual(doc);
});

test("keyed deletion undo and redo never widen history to the whole cells map", async () => {
  const f = await fixture();
  const before = f.mount.work()?.value;
  const result = await f.edit([{ path: ["cells", "1::1"], op: "delete" }]);
  if (result.kind !== "accepted") throw Error("refused");
  expect(result.ack.inverse.filter((p) => p.path[0] === "cells").map((p) => p.path)).toEqual([
    ["cells", "1::1"],
  ]);
  expect((await f.mount.history!.undo()).ok).toBe(true);
  expect(f.mount.work()?.value).toEqual(before);
  expect((await f.mount.history!.redo()).ok).toBe(true);
  expect(spec.schema.parse(f.mount.work()?.value).cells["1::1"]).toBeUndefined();
});

test("admitted mount through Work feed transport reaches the host reducer with the original keyed paths", async () => {
  const f = await fixture(true);
  const basis = f.mount.workBasis()!;
  expect((await f.edit([patch], basis)).kind).toBe("accepted");
  expect(f.reconcile.mock.calls[0]![1]).toEqual([patch]);
  expect(spec.schema.parse(f.mount.work()?.value).basis?.stale).toEqual([
    { key: "1::2", was: "b" },
  ]);
  expect(f.mount.work()?.revision).toBe(1);
  expect(await f.edit([patch], basis)).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision" },
  });
  expect((await f.mount.history!.undo()).ok).toBe(true);
  expect(f.mount.work()?.value).toEqual(seed());
  expect((await f.mount.history!.redo()).ok).toBe(true);
  expect(spec.schema.parse(f.mount.work()?.value).cells["1::1"]?.edit?.value).toBe("reviewed");
  const deleted = await f.edit([{ path: ["cells", "1::1"], op: "delete" }]);
  expect(deleted.kind).toBe("accepted");
  expect(f.reconcile.mock.calls.at(-1)![1]).toEqual([{ path: ["cells", "1::1"] }]);
});
