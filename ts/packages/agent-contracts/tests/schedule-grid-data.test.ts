import { expect, test } from "vite-plus/test";
import { rebindScheduleWork, scheduleCellBindingSchema, unstale } from "../src/index.ts";

const target = {
  elementId: 7,
  parameterId: 555,
  parameterName: "Load",
  storageType: "Double",
  isReadOnly: false,
  hasValue: true,
  rawValue: "100",
};
const binding = (targets: unknown[] | undefined) => ({
  columnNumber: 2,
  targetElementIds: [7],
  parameterName: "Load",
  parameterId: 555,
  storageType: "Double",
  isEditable: true,
  ...(targets ? { targets } : {}),
});

test("a stored binding without targets refuses; it can never arm a push", () => {
  expect(scheduleCellBindingSchema.safeParse(binding(undefined)).success).toBe(false);
});

test("an unset target's rawValue: null parses", () => {
  const parsed = scheduleCellBindingSchema.parse(
    binding([{ ...target, hasValue: false, rawValue: null }]),
  );
  expect(parsed.targets[0]).toMatchObject({ hasValue: false, rawValue: null });
});

test("a target without the rawValue key refuses", () => {
  const { rawValue: _rawValue, ...absent } = target;
  expect(scheduleCellBindingSchema.safeParse(binding([absent])).success).toBe(false);
});

test("a target without parameterName parses", () => {
  const { parameterName: _parameterName, ...absent } = target;
  expect(scheduleCellBindingSchema.parse(binding([absent])).targets[0]!.parameterId).toBe(555);
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
    cells: { "1::1": { staged: { value: "P-9" } }, "1::2": { staged: { value: "150 VA" } } },
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
