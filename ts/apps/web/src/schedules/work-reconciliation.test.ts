import { expect, test, vi } from "vite-plus/test";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { applyPatches, scheduleGridRouteState, type ReadingFrame } from "@pe/agent-contracts";

test("schedule Work retains persisted cells and domain edit reconciliation", async () => {
  const registrations = createRouteRegistrations().filter((r) => r.spec.route === "schedules");
  expect(registrations[0]?.spec.schema).toBe(scheduleGridRouteState.schema);
  expect(registrations[0]?.spec.reconcileEdit).toBe(scheduleGridRouteState.reconcileEdit);
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
  const frames: ReadingFrame[] = [];
  const release = observeResources(ws, { observe: () => () => {} })(
    {
      ...key,
      kind: "work",
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
    // The host clears only the reviewed key through the domain reconciliation.
    expect(after.basis?.stale).toEqual([{ key: "1::2", was: "untouched" }]);
  } finally {
    release();
  }
});
