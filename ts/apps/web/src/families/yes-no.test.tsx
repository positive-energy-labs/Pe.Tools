// @vitest-environment jsdom
/** F-J3-5b: a Yes/No parameter is a closed choice (CellListSelect); there is no free text. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Table } from "#/components/master-table/table";

import { useFamiliesColumns, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const OFFSET = {
  key: "Offset Symbol",
  name: "Offset Symbol",
  kind: "FamilyParameter",
  isInstance: false,
  isBuiltIn: false,
  isProjectOnly: false,
  familyCount: 1,
  yesNo: true,
} as ParamColumn;
const ROW: TypeRow = {
  key: "1::T",
  familyId: 1,
  familyName: "Backdraft Damper",
  categoryName: "Duct Accessories",
  typeName: "T",
  typeCount: 1,
  values: { "Offset Symbol": "No" },
  scopes: { "Offset Symbol": "Family" },
  formulas: { "Offset Symbol": "None" },
  storageTypes: { "Offset Symbol": "Integer" },
};

function Matrix({ propose }: { propose: (...args: unknown[]) => Promise<void> }) {
  const { columns } = useFamiliesColumns({
    familyState: () => ({ word: "", tone: "mute", note: "" }),
    params: [OFFSET],
    showUncommon: true,
    totalFamilies: 1,
    cells: {},
    wire: { segment: "cells", revision: 1, write: async () => null },
    propose: propose as never,
  });
  return <Table rows={[ROW]} columns={columns} rowKey={(r) => r.key} label="families" />;
}

test("a Yes/No cell is a closed choice: no free-text editor, a pick stages Yes or No", async () => {
  const propose = vi.fn(async () => {});
  const view = render(<Matrix propose={propose} />);
  const td = view.container.querySelector<HTMLElement>("td[data-master-cell]:last-child")!;
  // No text editor to type "Noj3-a-1" into: the cell is the in-cell list's button.
  expect(td.querySelector("input")).toBe(null);
  expect(td.querySelector("[data-cell-editor]")).not.toBe(null);
  // A printable key opens the list filtered by it; only the closed choices are offered.
  await act(async () => td.focus());
  await act(async () => fireEvent.keyDown(td, { key: "j" }));
  expect(propose).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(td, { key: "Escape" }));
  await act(async () => fireEvent.keyDown(td, { key: "Enter" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).not.toBeNull());
  expect([...document.querySelectorAll('[role="option"]')].map((el) => el.textContent)).toEqual([
    "Yes",
    "No",
  ]);
  await act(async () =>
    fireEvent.click(screen.getByText("Yes", { selector: '[role="option"] *, [role="option"]' })),
  );
  expect(propose).toHaveBeenCalledOnce();
  expect((propose.mock.calls[0] as unknown[])[1]).toMatchObject({ value: "Yes" });
});
