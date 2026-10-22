// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  scheduleGridCellSchema,
  showCellValue,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";
import { cellFromTrichotomy } from "@pe/kit/lang/cell";
import { WorkLines, workLines, type WorkCell } from "./lines";

afterEach(cleanup);

/** A Work cell as the contract admits it, addressed the way a route draws it. */
const cellOf = (key: string, column: string, row: string, raw: TrichotomyCellLike): WorkCell => {
  const cell = scheduleGridCellSchema.parse(raw);
  const value = showCellValue((cell.staged ?? cell.proposal)!.value);
  return { key, column, row, value, look: cellFromTrichotomy(cell, { value }) };
};

const CELLS = [
  cellOf("a", "PE_G___Model", "FCU-1", { proposal: { value: "FXMQ20" } }),
  cellOf("b", "PE_G___Model", "FCU-2", { proposal: { value: "FXMQ30" } }),
  cellOf("c", "PE_G___Model", "AHU-1", { proposal: { value: "FXMQ20" } }),
  // Contested: staged, and Pea counters it. It stays in Pea's tab.
  cellOf("d", "PE_G___Model", "HP-1", { staged: { value: "RXL24" }, proposal: { value: "RXL30" } }),
  // Staged by accepting Pea's value: yours to apply, Pea's authorship.
  cellOf("e", "PE_G___Model", "HP-2", { staged: { value: "RXL30" }, proposal: { value: "RXL30" } }),
  cellOf("f", "PE_G___Model", "HP-3", { staged: { value: "RXL36" } }),
  cellOf("g", "PE_G___Manufacturer", "FCU-1", { proposal: { value: "Daikin" } }),
];

test("pending cells group into one line per column and tab, values counted, authors merged", () => {
  expect(
    workLines(CELLS).map((line) => ({
      column: line.column,
      tab: line.tab,
      by: line.by,
      rows: line.cells.map((cell) => cell.row),
      values: line.values.map(({ value, count }) => [value, count]),
    })),
  ).toEqual([
    {
      column: "PE_G___Model",
      tab: "pea",
      by: "pea",
      rows: ["FCU-1", "FCU-2", "AHU-1", "HP-1"],
      values: [
        ["FXMQ20", 2],
        ["FXMQ30", 1],
        ["RXL24", 1],
      ],
    },
    {
      column: "PE_G___Model",
      tab: "yours",
      by: "pea+you",
      rows: ["HP-2", "HP-3"],
      values: [
        ["RXL30", 1],
        ["RXL36", 1],
      ],
    },
    {
      column: "PE_G___Manufacturer",
      tab: "pea",
      by: "pea",
      rows: ["FCU-1"],
      values: [["Daikin", 1]],
    },
  ]);
});

test("the tab is the route's field: absent opens Pea's, a pick goes to the owner, a chip locates", () => {
  const onTab = vi.fn();
  const locate = vi.fn();
  const cells = CELLS.map((cell) => (cell.key === "a" ? { ...cell, locate } : cell));
  const draw = (tab?: "pea" | "yours" | "all") => (
    <WorkLines
      cells={cells}
      store={{}}
      wire={{ segment: "cells", write: async () => null, revision: 1 }}
      tab={tab}
      onTab={onTab}
    />
  );
  const { rerender } = render(draw());
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByText("yours 2"));
  expect(onTab).toHaveBeenCalledWith("yours");
  rerender(draw("yours"));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  rerender(draw("pea"));
  fireEvent.click(screen.getByRole("button", { name: "FCU-1 · PE_G___Model" }));
  expect(locate).toHaveBeenCalledOnce();
});
