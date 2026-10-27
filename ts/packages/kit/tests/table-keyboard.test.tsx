// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Table } from "../src/components/master-table/table";
import { TextCell } from "../src/components/master-table/cells";
import { readKeyMeta, readRegistrations } from "../src/keys";

afterEach(cleanup);

function Harness() {
  const [note, setNote] = useState("Original");
  return (
    <>
      <Table
        rows={[
          { id: "one", note },
          { id: "two", note: "Other" },
        ]}
        rowKey={(row) => row.id}
        label="Keyboard table"
        columns={[
          { key: "id", label: "ID", cell: (row) => row.id },
          {
            key: "note",
            label: "Note",
            cell: (row) => <TextCell value={row.note} onCommit={setNote} />,
          },
        ]}
      />
      <output>{note}</output>
    </>
  );
}

const focus = (element: HTMLElement) => act(() => element.focus());

test("real grid keys move focus, enter editing, and publish their action metadata", () => {
  render(<Harness />);
  const cells = screen.getAllByRole("gridcell");
  focus(cells[0]!);
  fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(cells[1]);
  const ids = readRegistrations().map((entry) => readKeyMeta(entry.options.meta)?.actionId);
  expect(ids).toContain("table.move-up");
  expect(ids).toContain("table.edit-cell");
  fireEvent.keyDown(cells[1]!, { key: "F2" });
  const input = cells[1]!.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "Changed" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toBe("Changed");
  expect(document.activeElement).toBe(cells[3]);
});

test("Tab wraps to the next row and retains its native exit at the last cell", () => {
  render(<Harness />);
  const cells = screen.getAllByRole("gridcell");
  focus(cells[1]!);
  expect(fireEvent.keyDown(cells[1]!, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(cells[2]);
  focus(cells[3]!);
  expect(fireEvent.keyDown(cells[3]!, { key: "Tab" })).toBe(true);
});

test("multirow headers mount without measuring row geometry", () => {
  const measure = vi.spyOn(HTMLTableRowElement.prototype, "getBoundingClientRect");
  try {
    render(
      <Table
        label="Grouped"
        rows={[{ id: "one", value: "value" }]}
        rowKey={(row) => row.id}
        columns={[
          { key: "id", label: "ID", group: "Identity", lock: true, cell: (row) => row.id },
          { key: "value", label: "Value", group: "Reading", cell: (row) => row.value },
        ]}
      />,
    );
    expect(measure).not.toHaveBeenCalled();
  } finally {
    measure.mockRestore();
  }
});

test("a cell named from elsewhere takes focus; one the query hides is said, not dropped", () => {
  const hidden = vi.fn();
  const rows = [
    { id: "one", note: "Alpha" },
    { id: "two", note: "Beta" },
  ];
  const columns = [
    { key: "id", label: "ID", cell: (row: (typeof rows)[number]) => row.id },
    { key: "note", label: "Note", cell: (row: (typeof rows)[number]) => row.note },
  ];
  const draw = (activeKey: string, state?: { query: string }) => (
    <Table
      rows={rows}
      rowKey={(row) => row.id}
      label="Located table"
      columns={columns}
      activeKey={activeKey}
      activeColumn="note"
      onActiveHidden={hidden}
      {...(state ? { state: { ...state, sorts: [], hiddenColumns: [] } as never } : {})}
    />
  );
  const { rerender } = render(draw("two"));
  expect(document.activeElement?.textContent).toBe("Beta");
  expect(hidden).not.toHaveBeenCalled();
  rerender(draw("one", { query: "Beta" }));
  expect(hidden).toHaveBeenCalledWith("its row is hidden by the query");
});
