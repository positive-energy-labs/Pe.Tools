// @vitest-environment jsdom
/** F-J3-5b: a Yes/No parameter is a closed choice; free text is refused with its reason. */
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

test("a Yes/No cell refuses free text with a stated reason and stages Yes or No", async () => {
  const propose = vi.fn(async () => {});
  const view = render(<Matrix propose={propose} />);
  const input = view.container.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "Noj3-a-1" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(propose).not.toHaveBeenCalled();
  expect(screen.getByText(/Offset Symbol is Yes\/No/)).toBeTruthy();
  expect(input.value).toBe("No");

  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "yes" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  // Enter commits and the blur that follows re-commits the same text; each stages "Yes".
  expect(propose).toHaveBeenCalled();
  for (const call of propose.mock.calls as unknown[][])
    expect(call[1]).toMatchObject({ value: "Yes" });
});
