import { expect, test } from "vite-plus/test";
import { applyPatches, rebindScheduleWork, unstale, scheduleGridRouteState } from "../src/index.ts";

test("a wrong-typed schedule edit returns the invalid-document refusal and edit hint", () => {
  const result = applyPatches(scheduleGridRouteState, { version: 1, revision: 0, doc: { cells: {} } }, "human", [
    { path: ["cells", "1::2", "edit"], value: { value: { bogus: true } } },
  ], 0);
  expect(result).toMatchObject({ ok: false, kind: "error", error: "the patched document is invalid", hint: expect.stringContaining("Cell edits wrap the typed value") });
});

test("reconciliation throws on an unstamped edit instead of silently preserving stale marks", () => {
  const doc = {
    basis: { captureId: "a".repeat(64), stale: [{ key: "1::2", was: "100 VA" }] },
    cells: { "1::2": { edit: { value: "150 VA" } } },
  };
  expect(() => scheduleGridRouteState.reconcileEdit(doc, [
    { path: ["cells", "1::2", "edit"], value: { value: "150 VA" } },
  ])).toThrow();
});

/** A reading as the rebind sees it: an id and each row's bindings. */
const reading = (id: string, load: string | null, mark = "P-1") =>
  ({
    id: id.repeat(64),
    snapshot: {
      rows: [
        {
          rowNumber: 1,
          bindings: [
            { columnNumber: 1, rawValue: mark, displayValue: mark },
            ...(load === null
              ? []
              : [{ columnNumber: 2, rawValue: load, displayValue: `${load} VA` }]),
          ],
        },
      ],
    },
  }) as never;

test("a rebind names each changed staged cell with the value reviewed against; the first `was` survives later rebinds", () => {
  const doc = {
    basis: { captureId: "a".repeat(64) },
    cells: { "1::1": { edit: { by: "human" as const, value: "P-9" } }, "1::2": { edit: { by: "human" as const, value: "150 VA" } } },
    takenAt: null,
  };
  const [first] = rebindScheduleWork(doc, reading("a", "100"), reading("b", "120"));
  expect(first).toEqual({
    path: ["basis"],
    value: { captureId: "b".repeat(64), stale: [{ key: "1::2", was: "100 VA" }] },
  });
  const moved = { ...doc, basis: first!.value as never };
  expect(rebindScheduleWork(moved, reading("b", "120"), reading("c", "130"))[0]!.value).toEqual({
    captureId: "c".repeat(64),
    stale: [{ key: "1::2", was: "100 VA" }],
  });
  // An unreadable old basis: every staged cell is stale, and nothing was reviewed that can be named.
  expect(rebindScheduleWork(doc, null, reading("b", "100"))[0]!.value).toEqual({
    captureId: "b".repeat(64),
    stale: [
      { key: "1::1", was: null },
      { key: "1::2", was: null },
    ],
  });
  // A cell the old basis has no binding for: stale, `was` unknown.
  expect(rebindScheduleWork(doc, reading("a", null), reading("b", "100"))[0]!.value).toEqual({
    captureId: "b".repeat(64),
    stale: [{ key: "1::2", was: null }],
  });
  expect(unstale(moved, ["1::2"])).toEqual([{ path: ["basis", "stale"] }]);
  expect(unstale(moved, ["1::1"])).toEqual([]);
});
