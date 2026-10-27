// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { scheduleGridCellSchema, showCellValue, type CellLike } from "@pe/agent-contracts";
import { cellFromDraft } from "@pe/kit/lang/cell";
import { WorkLines, workLines, type WorkCell } from "./lines";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  HTMLElement.prototype.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A Work cell as the contract admits it, addressed the way a route draws it. */
const cellOf = (key: string, column: string, row: string, raw: CellLike): WorkCell => {
  const cell = scheduleGridCellSchema.parse(raw);
  const value = showCellValue((cell.edit ?? cell.suggestion)!.value);
  return { key, column, row, value, look: cellFromDraft(cell, { value }) };
};

const CELLS = [
  cellOf("a", "PE_G___Model", "FCU-1", { suggestion: { by: "pea", value: "FXMQ20" } }),
  cellOf("b", "PE_G___Model", "FCU-2", { suggestion: { by: "pea", value: "FXMQ30" } }),
  cellOf("c", "PE_G___Model", "AHU-1", { suggestion: { by: "pea", value: "FXMQ20" } }),
  // Contested: edit, and Pea counters it. It stays in Pea's tab.
  cellOf("d", "PE_G___Model", "HP-1", {
    edit: { by: "human", value: "RXL24" },
    suggestion: { by: "pea", value: "RXL30" },
  }),
  // Staged by accepting Pea's value: yours to apply, Pea's authorship.
  cellOf("e", "PE_G___Model", "HP-2", {
    edit: { by: "human", value: "RXL30" },
    suggestion: { by: "pea", value: "RXL30" },
  }),
  cellOf("f", "PE_G___Model", "HP-3", { edit: { by: "human", value: "RXL36" } }),
  cellOf("g", "PE_G___Manufacturer", "FCU-1", { suggestion: { by: "pea", value: "Daikin" } }),
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
      tab: "suggestions",
      by: "mixed",
      rows: ["FCU-1", "FCU-2", "AHU-1", "HP-1"],
      values: [
        ["FXMQ20", 2],
        ["FXMQ30", 1],
        ["RXL24", 1],
      ],
    },
    {
      column: "PE_G___Model",
      tab: "edits",
      by: "human",
      rows: ["HP-2", "HP-3"],
      values: [
        ["RXL30", 1],
        ["RXL36", 1],
      ],
    },
    {
      column: "PE_G___Manufacturer",
      tab: "suggestions",
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
  const draw = (tab?: "suggestions" | "edits" | "all") => (
    <WorkLines
      cells={cells}
      store={{}}
      wire={{ segment: "cells", write: async () => null, revision: 1 }}
      tab={tab}
      onTab={onTab}
    />
  );
  const { rerender } = render(draw());
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getAllByRole("option")[0]?.getAttribute("data-stage")).toBe("proposed");
  fireEvent.click(screen.getByText("edits 2"));
  expect(onTab).toHaveBeenCalledWith("edits");
  rerender(draw("edits"));
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getAllByRole("option")[0]?.getAttribute("data-stage")).toBe("edit");
  rerender(draw("suggestions"));
  fireEvent.click(screen.getByRole("button", { name: "FCU-1 · PE_G___Model" }));
  expect(locate).toHaveBeenCalledOnce();
});

test("a line verdict writes every covered cell once and does not activate the row", async () => {
  const write = vi.fn(async () => null);
  const locate = vi.fn();
  const store: Record<string, CellLike> = {
    a: { suggestion: { by: "pea", value: "one" } },
    b: { suggestion: { by: "pea", value: "two" } },
  };
  const cells = Object.entries(store).map(([key, cell]) => ({
    ...cellOf(key, "Model", key, cell),
    locate,
  }));
  render(
    <WorkLines
      cells={cells}
      store={store}
      wire={{ segment: "cells", write, revision: 7 }}
      tab="suggestions"
      onTab={() => {}}
    />,
  );
  fireEvent.click(within(screen.getByRole("option")).getByRole("button", { name: "take" }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(write).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ path: ["cells", "a", "edit"] }),
      expect.objectContaining({ path: ["cells", "b", "edit"] }),
    ]),
    7,
  );
  expect(locate).not.toHaveBeenCalled();
});
