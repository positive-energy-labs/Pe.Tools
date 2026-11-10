import { expect, test, vi } from "vite-plus/test";
import { setup } from "./schedule-recorded-fixture.ts";
import { nativeRecordingRequest } from "./native-recordings.ts";

test("recorded schedule push admits the real declaration, sends reviewed bindings and retains independent readback", async () => {
  const f = await setup();
  f.select("fresh-schedule-04-revit.detail.schedules");
  const result = await f.submit();
  expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded", result: { applied: 2, failures: [], rebind: "rebound" } });
  expect(result.result.readbackError).toBeUndefined();
  expect(f.sent.filter(call => call.key === "schedule.cells.apply")).toMatchObject([{ action: "schedule.grid.push", input: {
    scheduleId: f.request.scheduleId, scheduleUniqueId: f.request.scheduleUniqueId,
    edits: f.request.edits.map((edit: any) => ({ rowNumber: edit.rowNumber, columnNumber: edit.columnNumber, value: edit.value, expectedBinding: edit.expectedBinding })),
  } }]);
  for (const edit of f.request.edits) expect((await f.view()).doc.cells[`${edit.rowNumber}::${edit.columnNumber}`].edit).toBeNull();
  expect(f.reads()).toBe(2);
});

test("recorded schedule read runs its production command declaration before binding Work", async () => {
  const f = await setup({ cold: true });
  const response = await f.post("/actions", { id: "read", key: "schedule.grid.read", target: { kind: "document", ref: f.b }, input: {
    work: { key: f.scope, revision: 0 }, scheduleId: f.request.scheduleId,
  } });
  expect(response.status).toBeLessThan(400);
  const result = await f.owner().wait("read");
  expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded" });
  expect(f.sent.at(-1)).toMatchObject({ key: "revit.detail.schedules", action: "schedule.grid.read" });
  expect((await f.view()).doc.basis).toBeTruthy();
});

test("recorded native alias refusal keeps both authored schedule cells and its actual reason", async () => {
  const f = await setup();
  f.select("fresh-schedule-07-revit.detail.schedules", "fresh-schedule-09-schedule.cells.apply");
  await f.bind(await f.read());
  const request = nativeRecordingRequest("fresh-schedule-09-schedule.cells.apply");
  await f.patch(request.edits.map((edit: any) => ({ path: ["cells", `${edit.rowNumber}::${edit.columnNumber}`], value: { edit: { value: edit.value } } })));
  const result = await f.submit();
  expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded", result: { applied: 0, failures: expect.arrayContaining([expect.objectContaining({ error: expect.stringContaining("Conflicting edits alias") })]) } });
  for (const edit of request.edits) expect((await f.view()).doc.cells[`${edit.rowNumber}::${edit.columnNumber}`].edit.value).toBe(edit.value);
});

test("Work edits finish during recorded execution; acknowledgment cannot retire a newer authored value", async () => {
  const f = await setup();
  const admission = await f.admission();
  f.hold();
  const pending = f.submit(admission);
  await vi.waitFor(() => expect(f.sent.some(call => call.key === "schedule.cells.apply")).toBe(true));
  const edit = f.request.edits[0], key = `${edit.rowNumber}::${edit.columnNumber}`;
  try { expect(await f.patch([{ path: ["cells", key], value: { edit: { value: "Later designer intent" } } }])).toMatchObject({ ok: true }); }
  finally { f.release(); }
  expect(await pending).toMatchObject({ state: "succeeded" });
  expect((await f.view()).doc.cells[key].edit.value).toBe("Later designer intent");
  expect(f.sent.filter(call => call.key === "schedule.cells.apply")).toHaveLength(1);
});

test("stale schedule Work refuses before dispatch and a fresh admission crosses the same real declaration", async () => {
  const f = await setup();
  const admission = await f.admission();
  await f.patch([{ path: ["cells", "2::1"], value: { edit: { value: "Later intent" } } }]);
  expect(await f.submit(admission)).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.sent.filter(call => call.key === "schedule.cells.apply")).toHaveLength(0);
  expect(await f.submit()).toMatchObject({ state: "succeeded" });
  expect(f.sent.filter(call => call.key === "schedule.cells.apply")).toHaveLength(1);
});

// UNPROVEN[no recording]: missing/duplicate/malformed native acknowledgment, lost native
// outcome and recovered partial acknowledgment. The former response generator emulated these.
