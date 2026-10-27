import { expect, test, vi } from "vite-plus/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parameterValueApplyBounds } from "@pe/host-contracts/generated";
import {
  runSemanticAction,
  controlAction,
} from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { rebindScheduleWork } from "@pe/agent-contracts";
import { detailResponse, target } from "./schedule-fixture.ts";
import { cellsApplied, setup } from "./schedule-test-fixture.ts";

test("actual HTTP Work + journal consumes fanout only after positive acknowledgments; readback is independent", async () => {
  const f = await setup();
  const result = await f.submit();
  expect(result).toMatchObject({
    state: "succeeded",
    result: {
      applied: 1,
      failures: [],
      rebind: "rebound",
      readback: { snapshot: { rows: [{ values: ["P-1", "100 VA"] }] } },
      // No pod bound: the run receipt lives in this action record (host state), not in a pod.
      run: null,
      receipt: {
        podId: null,
        operation: "schedule.grid.push",
        outcome: "Succeeded",
        reason: null,
        scheduleId: 42,
        // This fixture's readback does not move, so after reads what Revit reported: unchanged.
        cells: [
          {
            cell: "1::2",
            elementIds: [7, 8],
            parameterId: 555,
            value: "150 VA",
            before: "100 VA",
            after: "100 VA",
            error: null,
            writes: [{ index: 0, ok: true }],
          },
        ],
      },
    },
  });
  expect((await f.view()).doc.cells["1::2"].edit).toBeNull();
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
  expect(f.sent.every((s) => s.session === "B" && s.openId === "open-B")).toBe(true);
  // Initial read and actual post-effect readback; the domain compares bindings inside its transaction.
  expect(f.reads()).toBe(2);
  // The reviewed binding goes back unchanged, targets and raw values included; the journal seals it.
  const request = f.sent.find((s) => s.key === "schedule.cells.apply")!.input;
  expect(request).toEqual({
    scheduleId: 42,
    scheduleUniqueId: "uid-42",
    edits: [
      {
        rowNumber: 1,
        columnNumber: 2,
        expectedBinding: f.reading.snapshot.rows[0]!.bindings[0],
        value: "150 VA",
      },
    ],
    transactionName: "Schedule grid push",
  });
  expect(request.edits[0].expectedBinding.targets).toEqual([target(7), target(8)]);
  const step = (await f.owner().list())[0]!.steps[0];
  expect(step).toMatchObject({ state: "succeeded", input: request, result: { appliedCells: 1 } });
});

test.each([
  ["missing", cellsApplied([])],
  ["refused", cellsApplied([[1, 2, false, "read only"]])],
  [
    "duplicate",
    {
      ...cellsApplied([[1, 2, true]]),
      results: [
        ...cellsApplied([
          [1, 2, true],
          [1, 2, true],
        ]).results,
      ].map((r) => ({ ...r, index: 0 })),
    },
  ],
  [
    "malformed",
    {
      ...cellsApplied([[1, 2, true]]),
      results: [{ index: 0, rowNumber: 1, columnNumber: 2, ok: "true" }],
    },
  ],
  ["another cell at the index", cellsApplied([[2, 2, true]])],
  ["dry run", cellsApplied([[1, 2, true]], { dryRun: true })],
])("%s keeps the staged cell", async (_name, response) => {
  const f = await setup();
  f.setResponse(response);
  const result = await f.submit();
  expect(result.result.applied).toBe(0);
  expect((await f.view()).doc.cells["1::2"].edit.value).toBe("150 VA");
});

test("staged cells over the generated cap refuse before dispatch and keep every cell", async () => {
  const over = parameterValueApplyBounds.maxEditsPerCall + 1;
  const f = await setup();
  const detail = detailResponse();
  detail.entries[0].rows = Array.from({ length: over }, (_, index) => ({
    ...detail.entries[0].rows[0],
    rowNumber: index,
    bindings: [
      {
        ...detail.entries[0].rows[0].bindings[0],
        targetElementIds: [index + 1],
        targets: [target(index + 1)],
      },
    ],
  }));
  f.setDetail(detail);
  const reading = await f.read();
  await f.bind(reading);
  await f.patch([
    {
      path: ["cells"],
      value: Object.fromEntries(
        Array.from({ length: over }, (_, index) => [`${index}::2`, { edit: { value: "150 VA" } }]),
      ),
    },
  ]);
  expect(await f.submit()).toMatchObject({ state: "failed", notDispatched: true });
  expect(Object.values((await f.view()).doc.cells).filter((c) => c.edit)).toHaveLength(over);
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
});

test("partial native outcome clears only a completely acknowledged cell and keeps explicit failures", async () => {
  const f = await setup();
  const detail = detailResponse();
  detail.entries[0].rows.push({
    ...detail.entries[0].rows[0],
    rowNumber: 2,
    bindings: [
      { ...detail.entries[0].rows[0].bindings[0], targetElementIds: [9], targets: [target(9)] },
    ],
  });
  f.setDetail(detail);
  const reading = await f.read();
  await f.bind(reading);
  await f.patch([{ path: ["cells", "2::2"], value: { edit: { value: "200 VA" } } }]);
  f.setResponse(
    cellsApplied([
      [1, 2, true],
      [2, 2, false, "read only"],
    ]),
  );
  // F-S-1: some cells written is a Succeeded push; each refused cell is listed with its reason.
  expect(await f.submit()).toMatchObject({
    result: {
      applied: 1,
      failures: [{ key: "2::2", error: "read only" }],
      receipt: {
        outcome: "Succeeded",
        reason: "1 of 2 cells refused: 2::2: read only",
        cells: [
          { cell: "1::2", error: null },
          { cell: "2::2", error: "read only" },
        ],
      },
    },
  });
  expect((await f.view()).doc.cells["1::2"].edit).toBeNull();
  expect((await f.view()).doc.cells["2::2"].edit.value).toBe("200 VA");
});

test("Work edits finish while native execution waits and settlement preserves later staged/proposed values", async () => {
  const f = await setup();
  f.hold();
  const admission = await f.admission();
  await f.post("/actions", admission);
  await vi.waitFor(() => expect(f.sent.some((s) => s.key === "schedule.cells.apply")).toBe(true));
  expect(
    await f.patch([
      { path: ["cells", "1::2", "edit"], value: { value: "200 VA" } },
      { path: ["cells", "1::2", "suggestion"], value: { value: "220 VA", by: "pea" } },
    ]),
  ).toMatchObject({ ok: true });
  f.release();
  await f.owner().wait(admission.id);
  expect((await f.view()).doc.cells["1::2"]).toMatchObject({
    edit: { value: "200 VA" },
    suggestion: { value: "220 VA" },
  });
});

test("lost acceptance and host remount replay the original admission once", async () => {
  const f = await setup();
  const original = await f.admission();
  f.lose();
  expect(
    await runSemanticAction(
      "schedule.grid.push",
      {},
      f.b,
      original.input.work as import("@pe/agent-contracts").WorkHandle,
      "",
      original.id,
    ),
  ).toMatchObject({ id: original.id, state: "succeeded" });
  await f.owner().wait(original.id);
  await f.restart();
  expect(
    await runSemanticAction(
      "schedule.grid.push",
      {},
      f.b,
      original.input.work as import("@pe/agent-contracts").WorkHandle,
      "",
      original.id,
    ),
  ).toMatchObject({ id: original.id, state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
});

test("lost native outcome remains staged, original receipt recovers without a fresh-ID retry", async () => {
  const f = await setup();
  f.unknown();
  const original = await f.admission();
  expect(await f.submit(original)).toMatchObject({ state: "unknown" });
  expect((await f.view()).doc.cells["1::2"].edit).toBeTruthy();
  expect((await f.post("/actions", await f.admission())).value).toMatchObject({
    state: "failed",
    notDispatched: true,
  });
  await f.restart();
  await controlAction("action.recover", { id: original.id }, "");
  await controlAction("action.resume", { id: original.id }, "");
  expect(await f.owner().wait(original.id)).toMatchObject({ state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
});

test("same document in A/B has exact independent lifetimes; subject change and reopen cannot redeem old cells", async () => {
  const f = await setup();
  const a = await f.read(f.a);
  expect(a.workspaceId).toBe(f.reading.workspaceId);
  expect(
    await f.submit({ ...(await f.admission()), target: { kind: "document", ref: f.a } }),
  ).toMatchObject({ state: "failed", notDispatched: true });
  const other = detailResponse();
  other.entries[0].scheduleId = 99;
  other.entries[0].scheduleUniqueId = "uid-99";
  f.setDetail(other);
  expect((await f.read()).workspaceId).not.toBe(f.scope.work);
  expect((await f.view()).doc.cells["1::2"].edit).toBeTruthy();
  f.setDetail(detailResponse());
  f.reopen();
  expect(await f.submit()).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
});

test("readback failure is explicit and original resume performs only a read, never another apply", async () => {
  const f = await setup();
  f.failReadback();
  const result = await f.submit();
  expect(result).toMatchObject({
    state: "incomplete",
    result: {
      applied: 1,
      readbackError: expect.stringContaining("readback unavailable"),
      rebind: "skipped:no-readback",
    },
  });
  expect((await f.post("/actions", await f.admission())).value).toMatchObject({
    state: "failed",
    notDispatched: true,
  });
  f.failReadback(false);
  await controlAction("action.resume", { id: result.id }, "");
  expect(await f.owner().wait(result.id)).toMatchObject({ state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
});

test("stale Work and agent admission refuse before dispatch; a stale binding is the domain's per-cell answer", async () => {
  const f = await setup();
  const original = await f.admission();
  expect((await f.post("/actions", { ...original, actor: "agent" })).status).toBe(409);
  await f.patch([{ path: ["cells", "1::2", "edit"], value: { value: "175 VA" } }]);
  expect(await f.submit(original)).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
  f.setResponse(cellsApplied([[1, 2, false, "Reviewed schedule cell evidence is stale."]]));
  expect(await f.submit()).toMatchObject({
    result: {
      applied: 0,
      failures: [{ key: "1::2", error: "Reviewed schedule cell evidence is stale." }],
    },
  });
  expect((await f.view()).doc.cells["1::2"].edit.value).toBe("175 VA");
  // One dispatch, never a retry through another parameter path.
  expect(f.sent.map((s) => s.key).filter((k) => k !== "revit.detail.schedules")).toEqual([
    "schedule.cells.apply",
  ]);
});

test("missing acknowledgments recover the same native receipt before original resume; no fresh dispatch", async () => {
  const f = await setup();
  f.setResponse(cellsApplied([]));
  const original = await f.admission();
  expect(await f.submit(original)).toMatchObject({ state: "incomplete" });
  f.setResponse(cellsApplied([[1, 2, true]]));
  await controlAction("action.recover", { id: original.id }, "");
  await controlAction("action.resume", { id: original.id }, "");
  expect(await f.owner().wait(original.id)).toMatchObject({ state: "succeeded" });
  expect((await f.view()).doc.cells["1::2"].edit).toBeNull();
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
});
test("a recovered partial acknowledgment retires newly proven cells without rewriting prior retirement or dispatching again", async () => {
  const f = await setup();
  const detail = detailResponse();
  detail.entries[0].rows.push({
    ...detail.entries[0].rows[0],
    rowNumber: 2,
    bindings: [
      { ...detail.entries[0].rows[0].bindings[0], targetElementIds: [9], targets: [target(9)] },
    ],
  });
  f.setDetail(detail);
  await f.bind(await f.read());
  await f.patch([{ path: ["cells", "2::2"], value: { edit: { value: "200 VA" } } }]);
  f.setResponse(cellsApplied([[1, 2, true]]));
  const original = await f.admission();
  expect(await f.submit(original)).toMatchObject({ state: "incomplete", result: { applied: 1 } });
  const first = (await f.owner().list(undefined, original.id))[0]!.steps.find(
    (step) => step.key === "work.retire",
  )!;
  expect((await f.view()).doc.cells["1::2"].edit).toBeNull();
  expect((await f.view()).doc.cells["2::2"].edit).toMatchObject({ value: "200 VA" });
  f.setResponse(
    cellsApplied([
      [1, 2, true],
      [2, 2, true],
    ]),
  );
  await controlAction("action.recover", { id: original.id }, "");
  await controlAction("action.resume", { id: original.id }, "");
  const completed = await f.owner().wait(original.id);
  expect(completed).toMatchObject({ state: "succeeded" });
  expect(completed.steps.find((step) => step.id === first.id)).toEqual(first);
  expect((await f.view()).doc.cells["2::2"].edit).toBeNull();
  expect(f.sent.filter((step) => step.key === "schedule.cells.apply")).toHaveLength(1);
});

/** Rewrite a stored reading the way a capture from before per-target evidence looks: no `targets`. */
async function strip(dir: string, id: string, workspaceId?: string) {
  const file = join(dir, "captures", "schedules", `${id}.json`);
  const reading = JSON.parse(await readFile(file, "utf8"));
  for (const row of reading.snapshot.rows)
    for (const binding of row.bindings) delete binding.targets;
  if (workspaceId) reading.workspaceId = workspaceId;
  await writeFile(file, JSON.stringify(reading));
}

test("a stored reading without targets refuses with 're-read the schedule' and never arms a push", async () => {
  const f = await setup();
  await strip(f.dir, f.reading.id);
  const refused = await f.submit();
  expect(refused).toMatchObject({ state: "failed", notDispatched: true });
  expect(String(refused.error)).toContain("re-read the schedule");
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
  expect((await f.view()).doc.cells["1::2"].edit.value).toBe("150 VA");
  for (const [key, input] of [
    ["schedule.grid.saved", { id: f.reading.id }],
    ["schedule.grid.work", { workspaceId: f.scope.work }],
  ] as const) {
    const read = await f.post("/schedules/readings", { key, input });
    expect(read.status).toBe(409);
    expect(read.value.error).toContain("re-read the schedule");
  }
});

/** Two bound cells in row 1: Mark (1::1) and Load (1::2) at `load`. */
const withMark = (load = "100") => {
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

test("F-H5-1: a dead-lifetime push names its exit; a re-read rebinds and marks a changed staged cell stale; it refuses per cell by code while the rest push live", async () => {
  const f = await setup();
  // Two cells under one basis: Mark (1::1) and Load (1::2, staged by setup).
  f.setDetail(withMark());
  const old = await f.read();
  await f.bind(old);
  await f.patch([{ path: ["cells", "1::1"], value: { edit: { value: "P-9" } } }]);
  f.reopen();
  const live = { session: "B", openId: "reopened-B" };
  const at = async () => ({
    ...(await f.admission()),
    target: { kind: "document" as const, ref: live },
  });
  expect(await f.submit(await at())).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringMatching(/re-opened in Revit; read it again/),
    issues: [expect.objectContaining({ code: "binding-lifetime-closed" })],
  });
  // Load changed while the document was closed; Mark did not.
  f.setDetail(withMark("120"));
  // Pea reads through the same door: the read never writes Work (ruling Q4, person-only rebind).
  const untouched = await f.view();
  const fresh = await f.read(live);
  expect(await f.view()).toEqual(untouched);
  // One human write: the live basis, with the changed staged cell marked stale. Cells untouched.
  expect(await f.bind(fresh)).toHaveProperty("envelope");
  const doc = (await f.view()).doc;
  expect(doc.basis).toEqual({ captureId: fresh.id, stale: [{ key: "1::2", was: "100 VA" }] });
  expect(doc.cells["1::1"].edit).toMatchObject({ value: "P-9" });
  expect(doc.cells["1::2"].edit).toMatchObject({ value: "150 VA" });
  // The stale cell refuses per cell, by code, before dispatch; the other cell pushes live.
  f.setResponse(cellsApplied([[1, 1, true]]));
  expect(await f.submit(await at())).toMatchObject({
    state: "succeeded",
    result: {
      applied: 1,
      failures: [{ key: "1::2", code: "stale-staged-cell", error: expect.stringMatching(/stale/) }],
    },
  });
  const pushed = f.sent.filter((s) => s.key === "schedule.cells.apply");
  expect(pushed).toHaveLength(1);
  expect(pushed[0]).toMatchObject({
    openId: "reopened-B",
    input: { edits: [{ rowNumber: 1, columnNumber: 1, value: "P-9" }] },
  });
  expect((await f.view()).doc.cells["1::2"].edit).toMatchObject({ value: "150 VA" });
});

test("ask A: a push refused on moved evidence rebinds on its readback; the refused cell is stale with what was reviewed, and accept then push lands it", async () => {
  const f = await setup();
  f.setDetail(withMark());
  const old = await f.read();
  await f.bind(old);
  await f.patch([{ path: ["cells", "1::1"], value: { edit: { value: "P-9" } } }]);
  // Revit moves Load (1::2) after the review; the domain refuses that cell on its evidence.
  f.setDetail(withMark("120"));
  // Edits follow the Work's cell order: 1::2 (staged by setup), then 1::1.
  const refused = cellsApplied([
    [1, 2, false, "Expected target evidence is stale"],
    [1, 1, true],
  ]);
  Object.assign(refused.results[0]!, { code: "target-evidence-stale" });
  f.setResponse(refused);
  const first = await f.submit();
  expect(first).toMatchObject({
    state: "succeeded",
    result: {
      applied: 1,
      // The native's code rides through when it supplies one; the host never parses the sentence.
      failures: [{ key: "1::2", code: "target-evidence-stale" }],
      rebind: "rebound",
    },
  });
  const readback = (first.result as { readback: { id: string } }).readback;
  // The readback rebinds in the push: basis = the readback, and the refused cell names A.
  let doc = (await f.view()).doc;
  expect(doc.basis).toEqual({ captureId: readback.id, stale: [{ key: "1::2", was: "100 VA" }] });
  expect(doc.cells["1::1"]?.edit).toBeNull();
  expect(doc.cells["1::2"].edit).toMatchObject({ value: "150 VA" });
  // Accept: restage B over C. The key leaves `basis.stale`; the push sends C as the evidence.
  await f.patch([{ path: ["cells", "1::2", "edit"], value: { value: "150 VA" } }]);
  f.setResponse(cellsApplied([[1, 2, true]]));
  expect(await f.submit()).toMatchObject({
    state: "succeeded",
    result: { applied: 1, failures: [] },
  });
  const pushed = f.sent.filter((s) => s.key === "schedule.cells.apply");
  expect(pushed).toHaveLength(2);
  expect(pushed[1]!.input.edits).toEqual([
    expect.objectContaining({
      rowNumber: 1,
      columnNumber: 2,
      value: "150 VA",
      expectedBinding: expect.objectContaining({ rawValue: "120" }),
    }),
  ]);
  doc = (await f.view()).doc;
  expect(doc.cells["1::2"]?.edit).toBeNull();
  expect(doc.basis).toEqual({ captureId: expect.any(String) });
});

test("the catalog names each schedule's Work before any read; an unread Work answers null", async () => {
  const f = await setup();
  f.addSchedule(43, "Unread");
  const listed = await f.post("/schedules/readings", {
    key: "schedule.grid.catalog",
    input: {},
    target: f.b,
  });
  const ids = Object.fromEntries(
    listed.value.schedules.map((s: { scheduleId: number; workspaceId: string }) => [
      s.scheduleId,
      s.workspaceId,
    ]),
  );
  // The catalog's id is the one the read files under: selecting it opens the same Work.
  expect(ids[42]).toBe(f.reading.workspaceId);
  expect(ids[43]).toMatch(/^schedule:[a-f0-9]{64}$/);
  const reads = f.reads();
  const unread = await f.post("/schedules/readings", {
    key: "schedule.grid.work",
    input: { workspaceId: ids[43] },
  });
  expect(unread).toEqual({ status: 200, value: null });
  expect(f.reads()).toBe(reads);
});

test("History lists every retained read of one Work, newest first, and each opens as saved", async () => {
  const f = await setup();
  const second = await f.read();
  const history = await f.post("/schedules/readings", {
    key: "schedule.grid.history",
    input: { workspaceId: f.reading.workspaceId },
  });
  expect(history.status).toBe(200);
  const ids = history.value.map((row: { id: string }) => row.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids)).toEqual(new Set([f.reading.id, second.id]));
  expect(history.value.map((row: { at: string }) => row.at)).toEqual(
    history.value
      .map((row: { at: string }) => row.at)
      .toSorted()
      .toReversed(),
  );
  const other = await f.post("/schedules/readings", {
    key: "schedule.grid.history",
    input: { workspaceId: "schedule:other" },
  });
  expect(other.value).toEqual([]);
});
