// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Table } from "../src/components/master-table/table";
import { ColumnQuery } from "../src/components/master-table/query-workbench";
import type { Column, QueryVocabulary, TableState } from "../src/components/master-table/model";

afterEach(cleanup);
type Row = { room: string; flow: number; note: string };
const rows: Row[] = [{ room: "office", flow: 4, note: "plain text" }];
const columns: Column<Row>[] = [
  {
    key: "room",
    label: "Room",
    facet: (row) => row.room,
    options: [{ value: "office", label: "Office" }],
    cell: (row) => row.room,
  },
  {
    key: "flow",
    label: "Flow",
    condition: { kind: "number", read: (row) => row.flow },
    sort: (row) => row.flow,
    cell: (row) => String(row.flow),
  },
  { key: "note", label: "Note", cell: (row) => row.note },
];
const vocabulary: QueryVocabulary = {
  fields: [
    { label: "Room", kind: "text", sort: "room" },
    { label: "Flow", kind: "number", sort: "flow" },
  ],
  rules: [],
  count: () => 1,
  values: () => [],
};
function Harness() {
  const [state, onStateChange] = useState<TableState>({ query: "", sorts: [] });
  return (
    <ColumnQuery.Provider value={{ vocabulary, state, onStateChange }}>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.room}
        label="Test table"
        state={state}
        onStateChange={onStateChange}
      />
      <output data-testid="state">{JSON.stringify(state)}</output>
    </ColumnQuery.Provider>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as TableState;
const cell = (label: string) => screen.getByRole("gridcell", { name: label });
const open = (target: HTMLElement, key?: string) => {
  act(() => target.focus());
  return key
    ? fireEvent.keyDown(target, { key, shiftKey: key === "F10" })
    : fireEvent.contextMenu(target);
};

test("real table cell menu writes text and numeric clauses once, then closes", async () => {
  render(<Harness />);
  open(cell("office"));
  fireEvent.click(await screen.findByRole("option", { name: "Room is Office" }));
  expect(state().query).toBe("Room=office");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  open(cell("4"), "ContextMenu");
  fireEvent.click(await screen.findByRole("option", { name: "Flow at least 4" }));
  expect(state().query).toBe("Room=office Flow>=4");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  open(cell("office"), "F10");
  expect(await screen.findByRole("listbox")).toBeTruthy();
});

test("copy uses rendered cell text and reports clipboard failure after dismissal", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<Harness />);
  open(cell("plain text"));
  fireEvent.click(await screen.findByRole("option", { name: /^Copy cell/ }));
  expect(writeText).toHaveBeenCalledWith("plain text");
  expect(await screen.findByText("Clipboard access failed")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
});

test("copy success uses the rendered label text", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<Harness />);
  open(cell("office"));
  fireEvent.click(await screen.findByRole("option", { name: /^Copy cell/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("office"));
  expect(screen.queryByText("Clipboard access failed")).toBeNull();
});

test("copy reports an unavailable clipboard", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  render(<Harness />);
  open(cell("plain text"));
  fireEvent.click(await screen.findByRole("option", { name: /^Copy cell/ }));
  expect(await screen.findByText("Clipboard access failed")).toBeTruthy();
});
