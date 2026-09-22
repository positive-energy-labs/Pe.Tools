// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  availableTransitions,
  scheduleGridSnapshotSchema,
  transitionPatches,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";
import { ScheduleGridWorkspace } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

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
  const apply = vi.fn(async () => null);
  const { container } = render(
    <ScheduleGridWorkspace
      state={{
        slice: { cells },
        revision: 7,
        hydrated: true,
        apply,
        execute: async () => null,
        snapshot,
        catalog: null,
        busy: null,
        refused: {},
        onFocus: { rail: () => {}, grid: () => {} },
        freshness: "current",
      }}
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
  expect(apply).toHaveBeenCalledWith(
    transitionPatches(["cells"], "1::1", cells["1::1"]!, { kind: "accept" }),
    7,
  );
  // The pending list draws the same cell's verbs, not its own.
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
