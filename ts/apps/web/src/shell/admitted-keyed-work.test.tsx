

// @vitest-environment jsdom
import { applyPatches, scheduleGridRouteState, workWriteSchema } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { WorkPatch } from "../../../../packages/agent-contracts/src/route-kernel-bodies";

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
