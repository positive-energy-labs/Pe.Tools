// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { cellsApplied, setup, stubEventSource } from "../../../../host/tests/schedule-test-fixture";
import { detailResponse, target } from "../../../../host/tests/schedule-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { REOPENED, schedulesManifest } from "./manifest";
import type { Refusal } from "#/route";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

/** Press push once `ready` lets it run: a bare not-ready refusal is `ready` speaking, nothing ran. */
const pushWhenReady = async (state: () => ScheduleGridState | undefined) => {
  let result: Refusal | null = null;
  await vi.waitFor(
    async () => {
      await act(async () => {
        result = await state()!.execute("push");
      });
      expect(result?.code === "not-ready" && !result.cells).toBe(false);
    },
    { timeout: 10_000 },
  );
  return result as Refusal | null;
};

test("real grid edits and route-approved proposals apply through HTTP, journal, Work and independent readback", async () => {
  const f = await setup();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  stubEventSource(f);
  await f.patch([{ path: ["cells"], value: {} }]);
  let state: ScheduleGridState | undefined;
  const view = () => (
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        // The document is the thread's; this test pins it instead of standing up a head.

        target={JSON.stringify({ kind: "open", ref: f.b })}
        render={(next) => {
          state = next;
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>
  );
  const mounted = render(view());
  await screen.findByDisplayValue("100 VA");
  const cell = screen.getByDisplayValue("100 VA");
  await act(async () => {
    fireEvent.change(cell, { target: { value: "175 VA" } });
    fireEvent.blur(cell);
  });
  await vi.waitFor(async () =>
    expect(
      (await f.view()).doc.cells["1::2"]?.staged?.value,
      JSON.stringify(f.requests.filter((r) => r.body)),
    ).toBe("175 VA"),
  );
  expect(await pushWhenReady(() => state)).toBeNull();
  // The same host lane as the second push below: native apply, journal and Work publication take
  // seconds when SSE and jsdom share one event loop under a full suite.
  await vi.waitFor(async () => expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined(), {
    timeout: 10_000,
  });
  await screen.findByDisplayValue("100 VA"); // Native read fixture did NOT report the authored 175.
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
  await f.patch([{ path: ["cells", "1::2", "proposal"], value: { value: "180 VA" } }]);
  // The proposal is accepted where it lives: the grid cell's own contract transition. The push's
  // readback is now the basis; until that capture loads, apply refuses "read the schedule". Accept
  // is idempotent, so press until it lands rather than racing the load.
  await vi.waitFor(async () => {
    const proposed = screen
      .queryByDisplayValue("180 VA")
      ?.closest<HTMLElement>("[data-master-cell]");
    const accept = proposed && within(proposed).queryByRole("button", { name: "accept" });
    if (accept) fireEvent.click(accept);
    expect((await f.view()).doc.cells["1::2"].staged?.value).toBe("180 VA");
  });
  // Work clears before the push ends: the host still reads back and persists the receipt, and the
  // button is busy until that receipt reads settled. In this lane host, SSE and jsdom share one
  // event loop, which stretches those steps to seconds (measured: a one-row journal persist
  // ~3.8 s), hence the long wait and the test's 20 s budget.
  expect(await pushWhenReady(() => state)).toBeNull();
  await vi.waitFor(() =>
    expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(2),
  );
  await vi.waitFor(async () => expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined());
  expect(f.sent.every((s) => s.session === "B" && s.openId === "open-B")).toBe(true);
  mounted.unmount();
}, 30_000);

test("F-H5-1..3: a dead-lifetime Work says read again; the bare verb re-reads the open schedule, rebinds, marks a changed cell stale with accept/deny, and the grid draws the new reading", async () => {
  // F-H5-2: the Situation presses a verb with no input.
  const manifest = schedulesManifest();
  expect(manifest.actions!.refresh.input.safeParse(undefined)).toMatchObject({ success: true });
  // Q4, the contract: the read that rebinds is the person's.
  expect(manifest.actions!.refresh.actor).toBe("human");

  const f = await setup(); // 1::2 staged "150 VA" under the open-B reading
  stubEventSource(f);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  f.reopen();
  const live = { session: "B", openId: "reopened-B" };
  let state: ScheduleGridState | undefined;
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: live })}
        render={(next) => {
          state = next;
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("P-1");
  // F-H5-1: the dead binding refuses before dispatch, by a reason that names the way out.
  await vi.waitFor(async () => expect((await state!.execute("push"))?.message).toBe(REOPENED));
  expect(REOPENED).toBe(
    "Re-opened in Revit since this was staged: read the schedule again. Changed cells come back marked stale.",
  );

  // The model moved while closed: Mark reads P-2, Load reads 120 VA.
  const next = detailResponse();
  const row = next.entries[0].rows[0];
  row.values = ["P-2", "120 VA"];
  row.bindings[0] = {
    ...row.bindings[0],
    rawValue: "120",
    displayValue: "120 VA",
    targets: [target(7, "120"), target(8, "120")],
  };
  f.setDetail(next);
  // The bare verb reads the open schedule and rebinds in one write; the changed cell is marked stale.
  await act(async () => {
    expect(await state!.execute("refresh")).toBeNull();
  });
  // F-H5-2: no input still reads the open schedule, not the active view.
  expect(
    f.sent.filter((s) => s.key === "revit.detail.schedules").at(-1)!.input.query,
  ).toMatchObject({
    kind: "ScheduleReferences",
    scheduleIds: [42],
  });
  const fresh = (await f.captures.scheduleWork(f.scope.work)) as { id: string };
  expect((await f.view()).doc).toMatchObject({
    basis: { captureId: fresh.id, stale: [{ key: "1::2", was: "100 VA" }] },
    cells: { "1::2": { staged: { value: "150 VA" } } },
  });
  // Drawn as drift against the live value, with the ruled accept/deny.
  // The grid cell carries the same verbs; press the pending strip's.
  const strip = await screen.findByRole("list", { name: "pending cells" });
  const accept = await within(strip).findByRole("button", { name: "accept" });
  expect(within(strip).getByRole("button", { name: "deny" })).toBeTruthy();
  // Drift is drawn by the kit StateCell; its note rides the hover title at row scale.
  expect((await screen.findAllByTitle(/accept to stage it again/)).length).toBeGreaterThan(0);
  // Accept re-stages the value and drops the key from stale.
  fireEvent.click(accept);
  await vi.waitFor(async () => expect((await f.view()).doc.basis).toEqual({ captureId: fresh.id }));
  expect((await f.view()).doc.cells["1::2"].staged).toEqual({ value: "150 VA" });
  // F-H5-3: the grid draws the new reading, not the old basis.
  await screen.findByText("P-2");
  expect(screen.queryByText("P-1")).toBeNull();
});

test("a push's refused cell draws refused by its code on the cell, and the log line counts it", async () => {
  const f = await setup(); // 1::2 staged "150 VA"
  // Mark (1::1) and Load (1::2) each behind their own binding, as in the host's rebind test.
  const withMark = (load: string) => {
    const d = detailResponse();
    const row = d.entries[0].rows[0];
    row.bindings[0] = {
      ...row.bindings[0],
      rawValue: load,
      displayValue: `${load} VA`,
      targets: [target(7, load), target(8, load)],
    };
    row.bindings.unshift({
      ...row.bindings[0],
      columnNumber: 1,
      targetElementIds: [7],
      parameterName: "Mark",
      parameterId: 556,
      storageType: "String",
      rawValue: "P-1",
      displayValue: "P-1",
      isTypeParameter: false,
      targets: [
        { ...target(7, "P-1"), parameterId: 556, parameterName: "Mark", storageType: "String" },
      ],
    });
    return d;
  };
  f.setDetail(withMark("100"));
  const old = await f.read();
  await f.patch([
    { path: ["basis"], value: { captureId: old.id } },
    { path: ["cells", "1::1"], value: { staged: { value: "P-9" } } },
  ]);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  stubEventSource(f);
  f.reopen();
  const live = { session: "B", openId: "reopened-B" };
  let state: ScheduleGridState | undefined;
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: live })}
        render={(next) => {
          state = next;
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(async () => expect((await state!.execute("push"))?.message).toBe(REOPENED));
  // Load moved while closed: the rebind marks 1::2 stale; 1::1 (Mark) pushes live.
  f.setDetail(withMark("120"));
  await act(async () => {
    expect(await state!.execute("refresh")).toBeNull();
  });
  await vi.waitFor(async () =>
    expect((await f.view()).doc).toMatchObject({
      basis: { stale: [{ key: "1::2", was: "100 VA" }] },
    }),
  );
  f.setResponse(cellsApplied([[1, 1, true]]));
  const refusal = await pushWhenReady(() => state);
  expect(refusal).toMatchObject({ code: "partial", cells: ["1::2"] });
  expect(refusal!.message).toMatch(/^1 refused · /);
  await vi.waitFor(() => expect(state!.refused).toEqual({ "1::2": "stale" }));
});
