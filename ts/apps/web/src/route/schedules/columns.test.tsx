// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  availableTransitions,
  scheduleGridSnapshotSchema,
  transitionPatches,
  type ScheduleGridDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { ScheduleGridWorkspace } from "./workspace";
import { useScheduleGridColumns } from "./columns";
import { ScheduleReview } from "./review";
import {
  conditionValues,
  emptyTableState,
  visibleRows,
  wordMatches,
} from "#/components/master-table/view";

/** The field spec `revit.detail.schedules` sends for an Integer column. */
const INTEGER = { definition: { dataTypeId: "autodesk.spec:spec.int64-2.0.0" } };

afterEach(cleanup);

/** The grid's one write door, recorded: each call's patches and the revision they were bound to. */
function writes() {
  const calls: [RouteStatePatch[], number | undefined][] = [];
  const apply = async (patches: RouteStatePatch[], revision?: number) => {
    calls.push([patches, revision]);
    return null;
  };
  return { calls, apply };
}

/** The grid's refusal door, recorded: what the route would log. */
function refusals() {
  const said: string[] = [];
  return { said, onRefused: (says: string) => void said.push(says) };
}

function Columns({
  args,
  into,
}: {
  args: Parameters<typeof useScheduleGridColumns>;
  into: { current: ReturnType<typeof useScheduleGridColumns> };
}) {
  into.current = useScheduleGridColumns(...args);
  return null;
}

test("schedule conditions combine displayed staged text with numeric quantity and numeric sorting", () => {
  const read = scheduleGridSnapshotSchema.parse({
    scheduleId: 2,
    scheduleName: "Terminals",
    columns: [
      { columnNumber: 1, headerText: "Model", fieldName: "Model" },
      { columnNumber: 2, headerText: "Quantity", fieldName: "Count", parameter: INTEGER },
      { columnNumber: 3, headerText: "Mark", fieldName: "Mark" },
    ],
    rows: [
      { rowNumber: 1, values: ["Custom millwork", "1", "1"], bindings: [] },
      { rowNumber: 2, values: ["Standard", "4", "4"], bindings: [] },
      { rowNumber: 3, values: ["custom millwork ", "14", "14"], bindings: [] },
    ],
  });
  const result = { current: [] as ReturnType<typeof useScheduleGridColumns> };
  render(
    <Columns
      into={result}
      args={[
        read,
        { "2::1": { staged: { value: "Millwork grille" } } },
        { segment: "cells", revision: 1, write: async () => null },
        async () => undefined,
        async () => null,
      ]}
    />,
  );
  const state = { ...emptyTableState(), query: "Model~millwork Quantity>1" };
  expect(visibleRows(read.rows, result.current, state).map((row) => row.rowNumber)).toEqual([2, 3]);
  // `!` negates any clause, and a free word too.
  expect(
    visibleRows(read.rows, result.current, { ...state, query: "!Model~millwork" }).map(
      (row) => row.rowNumber,
    ),
  ).toEqual([]);
  expect(
    visibleRows(read.rows, result.current, { ...state, query: "!grille" }).map(
      (row) => row.rowNumber,
    ),
  ).toEqual([1, 3]);
  expect(
    visibleRows(read.rows, result.current, {
      ...state,
      sorts: [{ key: "c2", dir: "desc" }],
    }).map((row) => row.rowNumber),
  ).toEqual([3, 2]);
  expect(
    visibleRows(read.rows, result.current, {
      ...state,
      query: `${state.query} grille`,
    }).map((row) => row.rowNumber),
  ).toEqual([2]);
  // A bare number matches that number in a cell, never digits inside a longer one.
  for (const hit of ["4", "4.0", "4 ea", "Level 4", "4'-0\""])
    expect(wordMatches(hit, "4")).toBe(true);
  for (const miss of ["14", "0.4", "A-104", "40"]) expect(wordMatches(miss, "4")).toBe(false);
  const ids = (query: string) =>
    visibleRows(read.rows, result.current, { ...emptyTableState(), query }).map(
      (row) => row.rowNumber,
    );
  expect(ids("4")).toEqual([2]);
  expect(ids("millwork 14")).toEqual([3]);
  // Number or text is the declared spec: a Mark of digits is still text (ruling 25).
  expect(result.current.find((column) => column.key === "c3")?.condition?.kind).toBe("text");
  // An offered value and `is` read the same trimmed, case-folded text: the count is the match.
  const model = result.current.find((column) => column.key === "c1")!;
  expect(conditionValues(read.rows, model.condition!)).toContainEqual({
    value: "Custom millwork",
    count: 2,
  });
  const is = { ...emptyTableState(), query: 'Model="Custom millwork"' };
  expect(visibleRows(read.rows, result.current, is).map((row) => row.rowNumber)).toEqual([1, 3]);
});

test("millwork in Model AND Count > 1, through the query box, the header, and its chips", () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  const read = scheduleGridSnapshotSchema.parse({
    scheduleId: 3,
    scheduleName: "Casework",
    columns: [
      { columnNumber: 1, headerText: "Model", fieldName: "Model" },
      { columnNumber: 2, headerText: "Count", fieldName: "Count", parameter: INTEGER },
      { columnNumber: 3, headerText: "Room Name", fieldName: "Room: Name" },
    ],
    rows: [
      { rowNumber: 1, values: ["Millwork A", "2", "Office"], bindings: [] },
      { rowNumber: 2, values: ["Millwork B", "1", "Lab"], bindings: [] },
      { rowNumber: 3, values: ["Level 14", "3", "Office"], bindings: [] },
      { rowNumber: 4, values: ["Other", "4", "Store"], bindings: [] },
    ],
  });
  const workspace = (snapshot: typeof read) => (
    <ScheduleGridWorkspace
      state={{
        slice: { cells: {}, takenAt: null },
        revision: 1,
        hydrated: true,
        apply: async () => null,
        execute: async () => null,
        snapshot,
        catalog: null,
        busy: null,
        refused: {},
        onFocus: { grid: () => {} },
        freshness: "current",
      }}
      onRefused={() => undefined}
    />
  );
  const { container, rerender } = render(workspace(read));
  const box = screen.getByRole<HTMLInputElement>("combobox", { name: "table query" });
  const pick = (label: string) =>
    fireEvent.click(within(screen.getByRole("listbox")).getByText(label));
  const shown = () => container.querySelectorAll("tbody tr").length;

  const chip = (name: string) => screen.queryByRole("button", { name });

  // Free text narrows as it is typed: "4" is the number 4, not the 4 in "Level 14".
  fireEvent.change(box, { target: { value: "4" } });
  expect(shown()).toBe(1);
  fireEvent.change(box, { target: { value: "" } });
  expect(shown()).toBe(4);

  // A half-typed field name is a proposal, not a search that empties the grid.
  box.focus();
  fireEvent.change(box, { target: { value: "mod" } });
  expect(shown()).toBe(4);
  // The typed word leads the list with its hit count, so Enter keeps it (MAP ruling 47).
  expect(within(screen.getByRole("listbox")).getAllByRole("option")[0]?.textContent).toContain(
    "search “mod” in any field",
  );
  // Real fields only: the row-number gutter is not offered, and has no filter press.
  fireEvent.change(box, { target: { value: "" } });
  expect(within(screen.getByRole("listbox")).queryByText("#")).toBeNull();
  expect(screen.queryByRole("button", { name: "filter #" })).toBeNull();
  // A multi-word field name typed across a space is still a proposal, and picking it quotes it
  // and leaves no stray search word behind.
  for (const value of ["Room", "Room ", "Room Na"]) fireEvent.change(box, { target: { value } });
  expect(shown()).toBe(4);
  pick("Room Name");
  expect(box.value).toBe('"Room Name"');
  expect(screen.queryByText(/^search:/)).toBeNull();
  // Escape cancels the draft through the list's door (ruling 24).
  fireEvent.keyDown(box, { key: "Escape" });
  expect(box.value).toBe("");
  // A field name autocompletes, then its operators (Enter takes the top one), then values.
  fireEvent.change(box, { target: { value: "mod" } });
  pick("Model");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(box.value).toBe("Model~");
  fireEvent.change(box, { target: { value: "Model~millwork" } });
  pick("millwork");
  expect(chip("Model contains millwork")).toBeTruthy();
  // The header's filter press opens the same draft. Offered values count the rows in scope:
  // with the millwork chip applied, Count offers only 1 and 2 (ruling 26).
  fireEvent.click(screen.getByRole("button", { name: "filter Count" }));
  expect(box.value).toBe("Count");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(box.value).toBe("Count=");
  const offered = within(screen.getByRole("listbox"));
  expect(offered.getByText("2")).toBeTruthy();
  expect(offered.queryByText("4")).toBeNull();
  // The operator is text: ">=" typed key by key waits for its number.
  fireEvent.change(box, { target: { value: "Count>" } });
  fireEvent.change(box, { target: { value: "Count>=" } });
  expect(box.value).toBe("Count>=");
  fireEvent.change(box, { target: { value: "Count>=2" } });
  pick("2");
  expect(shown()).toBe(1);
  expect(screen.getByText("1 of 4 rows")).toBeTruthy();
  expect(screen.getByRole("button", { name: "filter Count" }).getAttribute("aria-pressed")).toBe(
    "true",
  );

  // A chip edits in place as its text; Backspace on an empty box takes the last chip back.
  fireEvent.click(screen.getByRole("button", { name: "Count ≥ 2" }));
  expect(box.value).toBe("Count>=2");
  fireEvent.change(box, { target: { value: "Count>=1" } });
  pick("1");
  expect(screen.getByText("2 of 4 rows")).toBeTruthy();
  fireEvent.keyDown(box, { key: "Backspace" });
  expect(box.value).toBe("Count>=1");
  expect(chip("Count ≥ 1")).toBeNull();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(chip("Model contains millwork")).toBeTruthy();

  // A sort is a chip in the same grammar: a field, then `sort ↓`.
  fireEvent.change(box, { target: { value: "cou" } });
  pick("Count");
  pick("sort ↓");
  expect(screen.getByText("Count sort ↓")).toBeTruthy();
  expect(container.querySelector("tbody tr")?.textContent).toContain("Millwork A");

  // `is empty` needs no value: it commits from the operator step, and edits as its text.
  fireEvent.change(box, { target: { value: "mod" } });
  pick("Model");
  pick("is empty");
  fireEvent.click(screen.getByRole("button", { name: "Model is empty" }));
  expect(box.value).toBe("Model=");
  fireEvent.blur(box);

  // A schedule switch drops the box's held text with the schedule it was typed against.
  box.focus();
  fireEvent.change(box, { target: { value: "mod" } });
  rerender(workspace({ ...read, scheduleId: 4 }));
  expect(screen.getByRole<HTMLInputElement>("combobox", { name: "table query" }).value).toBe("");
});

const binding = (columnNumber: number, blocker = "None") => ({
  columnNumber,
  targetElementIds: [11],
  parameterName: `P${columnNumber}`,
  storageType: "String",
  displayValue: "100 VA",
  isEditable: true,
  blocker,
  // The ruled capture carries per-target evidence (schedule.cells.apply compares it).
  targets: [
    {
      elementId: 11,
      parameterId: 100 + columnNumber,
      parameterName: `P${columnNumber}`,
      storageType: "String",
      isReadOnly: false,
      hasValue: true,
      rawValue: "100 VA",
    },
  ],
});
const snapshot = scheduleGridSnapshotSchema.parse({
  scheduleId: 1,
  scheduleName: "Panels",
  columns: [1, 2].map((n) => ({ columnNumber: n, headerText: `c${n}`, fieldName: `f${n}` })),
  rows: [
    { rowNumber: 1, values: ["100 VA", "100 VA"], bindings: [binding(1), binding(2, "Pinned")] },
  ],
});
const cells: ScheduleGridDocument["cells"] = {
  "1::1": { proposal: { value: "180 VA" } },
  "1::2": { proposal: { value: "190 VA" } },
};

test("a grid cell draws the contract's transitions and accept writes at the rendered revision", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  const { calls, apply } = writes();
  const refused = refusals();
  const { container } = render(
    <ScheduleGridWorkspace
      state={{
        slice: { cells, takenAt: null },
        revision: 7,
        hydrated: true,
        apply,
        execute: async () => null,
        snapshot,
        catalog: null,
        busy: null,
        refused: {},
        onFocus: { grid: () => {} },
        freshness: "current",
      }}
      onRefused={refused.onRefused}
    />,
  );
  const grid = [...container.querySelectorAll<HTMLElement>("[data-master-cell]")];
  const cellAt = (value: string) =>
    grid.find((td) => td.querySelector("input")?.value === value || td.textContent === value)!;
  const verbs = (td: HTMLElement) =>
    within(td)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

  // Stage is typing: the cell's input, not a button.
  expect(verbs(cellAt("180 VA"))).toEqual(
    availableTransitions(cells["1::1"]!, "human", { lock: null }).filter((k) => k !== "stage"),
  );
  expect(cellAt("180 VA").querySelector("input")).not.toBeNull();
  // Pinned: a lock leaves only deny, which clears a stray proposal.
  expect(verbs(cellAt("190 VA"))).toEqual(["deny"]);

  await act(async () =>
    fireEvent.click(within(cellAt("180 VA")).getByRole("button", { name: "accept" })),
  );
  expect(calls).toEqual([
    [transitionPatches(["cells"], "1::1", cells["1::1"]!, { kind: "accept" }), 7],
  ]);
  calls.length = 0;
  const editor = cellAt("180 VA").querySelector("input")!;
  editor.focus();
  fireEvent.change(editor, { target: { value: "Titus" } });
  await act(async () => fireEvent.keyDown(editor, { key: "Enter" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe(7);
});

test("Shift selected schedule cells fill in one revision checked write; focused copy and paste use cell text", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  const { calls, apply } = writes();
  const refused = refusals();
  const editable = scheduleGridSnapshotSchema.parse({
    ...snapshot,
    rows: [
      { rowNumber: 1, values: ["a", "b"], bindings: [binding(1), binding(2)] },
      { rowNumber: 2, values: ["c", "d"], bindings: [binding(1), binding(2)] },
    ],
  });
  const { container } = render(
    <ScheduleGridWorkspace
      state={{
        slice: { cells: {}, takenAt: null },
        revision: 9,
        hydrated: true,
        apply,
        execute: async () => null,
        snapshot: editable,
        catalog: null,
        busy: null,
        refused: {},
        onFocus: { grid: () => {} },
        freshness: "current",
      }}
      onRefused={refused.onRefused}
    />,
  );
  const rows = [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const first = rows[0]!.querySelectorAll<HTMLTableCellElement>("[data-master-cell]")[1]!;
  const last = rows[1]!.querySelectorAll<HTMLTableCellElement>("[data-master-cell]")[1]!;
  fireEvent.mouseDown(first.querySelector("input")!);
  fireEvent.mouseDown(last.querySelector("input")!, { shiftKey: true });
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(2);
  fireEvent.keyDown(last, { key: "T" });
  const draft = container.querySelector<HTMLInputElement>(
    'input[aria-label="Fill selected cells"]',
  )!;
  fireEvent.change(draft, { target: { value: "Titus" } });
  expect(calls).toHaveLength(0);
  await act(async () => fireEvent.keyDown(draft, { key: "Enter" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe(9);
  expect(calls[0]?.[0]).toHaveLength(2);
  expect(calls[0]?.[0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: expect.objectContaining({ value: "Titus" }) }),
    ]),
  );

  const copied: [string, string][] = [];
  fireEvent.mouseDown(first.querySelector("input")!);
  fireEvent.copy(first, {
    clipboardData: { setData: (kind: string, text: string) => copied.push([kind, text]) },
  });
  expect(copied).toEqual([["text/plain", "100 VA"]]);
  calls.length = 0;
  fireEvent.mouseDown(last.querySelector("input")!);
  await act(async () => fireEvent.paste(last, { clipboardData: { getData: () => "copied\r\n" } }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toHaveLength(1);
  // One cell copied from Excel ends in a line break; it is still one value.
  expect(calls[0]?.[0]).toEqual([
    expect.objectContaining({ value: expect.objectContaining({ value: "copied" }) }),
  ]);
  expect(calls[0]?.[1]).toBe(9);
});

test("a range containing a locked schedule cell refuses the whole fill", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  const { calls, apply } = writes();
  const refused = refusals();
  const { container } = render(
    <ScheduleGridWorkspace
      state={{
        slice: { cells: {}, takenAt: null },
        revision: 3,
        hydrated: true,
        apply,
        execute: async () => null,
        snapshot,
        catalog: null,
        busy: null,
        refused: {},
        onFocus: { grid: () => {} },
        freshness: "current",
      }}
      onRefused={refused.onRefused}
    />,
  );
  const row = container.querySelectorAll<HTMLTableCellElement>("tbody [data-master-cell]");
  fireEvent.mouseDown(row[1]!.querySelector("input")!);
  fireEvent.mouseDown(row[2]!, { shiftKey: true });
  fireEvent.keyDown(row[2]!, { key: "X" });
  const draft = container.querySelector<HTMLInputElement>(
    'input[aria-label="Fill selected cells"]',
  )!;
  fireEvent.change(draft, { target: { value: "Titus" } });
  await act(async () => fireEvent.keyDown(draft, { key: "Enter" }));
  expect(calls).toHaveLength(0);
  expect(refused.said).toEqual([expect.stringContaining("blocked: Pinned")]);
});

test("the Work slot's review list locates a row and accepts at the displayed Work revision", () => {
  const cell = { proposal: { value: "Titus" } };
  const { calls, apply } = writes();
  const located: (string | null)[] = [];
  render(
    <ScheduleReview
      state={{
        slice: { cells: { "1::1": cell }, takenAt: null },
        revision: 7,
        hydrated: true,
        apply,
        locateRow: (row) => void located.push(row as string | null),
        busy: null,
        catalog: null,
        refused: {},
        freshness: "current",
        execute: async () => null,
        onFocus: { grid: () => {} },
        snapshot: scheduleGridSnapshotSchema.parse({
          scheduleId: 1,
          scheduleName: "GRD",
          columns: [{ columnNumber: 1, headerText: "Manufacturer", fieldName: "Manufacturer" }],
          rows: [
            {
              rowNumber: 1,
              values: ["Custom"],
              bindings: [
                {
                  columnNumber: 1,
                  targetElementIds: [11],
                  storageType: "String",
                  displayValue: "Custom",
                  isEditable: true,
                  blocker: "None",
                  targets: [],
                },
              ],
            },
          ],
        }),
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Manufacturer/ }));
  expect(located).toEqual(["1"]);
  fireEvent.click(screen.getByRole("button", { name: "accept" }));
  expect(calls).toEqual([[transitionPatches(["cells"], "1::1", cell, { kind: "accept" }), 7]]);
});
