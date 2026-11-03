import { expect, test, vi } from "vite-plus/test";
import { builtinEnrollments } from "../../../host/src/builtin-enrollment";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { createBuiltinRouteInventory } from "../../../../packages/agent-contracts/src/route-module";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { applyPatches, scheduleGridRouteState, type ReadingFrame } from "@pe/agent-contracts";

test("G4: admitted host opens existing schedule Work but preserves domain edit reconciliation", async () => {
  const entry = builtinEnrollments.find((e) => e.routeKey === "schedules")!;
  expect(entry).toBeDefined();
  const completeHostModule = await entry.load();
  expect(completeHostModule.workState).toBe(scheduleGridRouteState);
  const inventory = createBuiltinRouteInventory({
    schedules: { host: true, module: completeHostModule, closure: entry.closure, catalog: [] },
  });
  const admitted = (await inventory.prepare("schedules", entry.closure.fingerprint)).admitHost(
    completeHostModule,
  );
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const registrations = createRouteRegistrations();
  expect(registrations.some((r) => r.spec.route === "schedules")).toBe(false);
  const key = {
    binding: "workspace" as const,
    route: "schedules",
    target: null,
    work: "schedule:fixture",
  };
  let saved: unknown = {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: scheduleGridRouteState.schema.parse({
      basis: {
        captureId: "a".repeat(64),
        stale: [
          { key: "1::1", was: "old" },
          { key: "1::2", was: "untouched" },
        ],
      },
      cells: { "1::1": { edit: { value: "persisted" } } },
    }),
    history: [],
  };
  const ws = new RouteWorkspace({
    registrations,
    store: {
      getState: async () => saved,
      setState: async ({ value }) => {
        saved = value;
      },
    },
  });
  const registration = ws.registerAdmitted(admitted.route);
  expect(await registration.ready).toBeNull();
  const frames: ReadingFrame[] = [];
  const release = observeResources(ws, { observe: () => () => {} })(
    {
      ...key,
      kind: "work",
      admission: { routeKey: "schedules", fingerprint: admitted.route.workFingerprint },
    },
    (f) => frames.push(f),
  );
  try {
    await vi.waitFor(() =>
      expect(frames).toContainEqual(
        expect.objectContaining({
          kind: "snapshot",
          value: expect.objectContaining({
            revision: 7,
            doc: expect.objectContaining({ cells: { "1::1": { edit: { value: "persisted" } } } }),
          }),
        }),
      ),
    );

    const before = scheduleGridRouteState.schema.parse((await ws.read(key, "schedules"))!.doc);
    const direct = applyPatches(
      scheduleGridRouteState,
      { version: 1, revision: 7, doc: before },
      "human",
      [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }],
      7,
    );
    expect(direct.ok && direct.envelope.doc.basis?.stale).toEqual([
      { key: "1::2", was: "untouched" },
    ]);
    const result = await ws.write(key, "schedules", "human", {
      kind: "apply",
      expectedRevision: 7,
      press: "review-cell",
      patches: [{ path: ["cells", "1::1", "edit"], value: { value: "reviewed" } }],
    });
    expect(result.ok).toBe(true);
    const after = scheduleGridRouteState.schema.parse((await ws.read(key, "schedules"))!.doc);
    // G4: the host clears only the reviewed key through the domain reconciliation.
    expect(after.basis?.stale).toEqual([{ key: "1::2", was: "untouched" }]);
    const duplicate = new RouteWorkspace({
      registrations: [{ spec: scheduleGridRouteState }],
      store: { getState: async () => undefined, setState: async () => {} },
    });
    expect(() => duplicate.registerAdmitted(admitted.route)).toThrow(
      /duplicate|already|registered/i,
    );
  } finally {
    release();
    registration.close();
  }
});
