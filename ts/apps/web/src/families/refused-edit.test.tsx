// @vitest-environment jsdom
/**
 * 25 item 3 (execution's hold-4b nit): a /families cell edit the door REFUSES must not leave the
 * typed text looking staged while the band reads 0 staged. The cell goes back to its drawn value
 * (the baseline, or what is staged) and says the refusal on the cell.
 */
import type { FamilyCellState } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Table } from "#/components/master-table/table";
import { refuse } from "#/route/refusal";

import { useFamiliesColumns, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const PARAMS = [
  {
    key: "Model",
    name: "Model",
    kind: "FamilyParameter",
    isInstance: false,
    isBuiltIn: false,
    isProjectOnly: false,
    familyCount: 1,
  } as ParamColumn,
];
const ROWS: TypeRow[] = [
  {
    key: "Fan Coil::T",
    familyId: 1,
    familyName: "Fan Coil",
    categoryName: "Mechanical Equipment",
    typeName: "T",
    typeCount: 1,
    values: { Model: "FXMQ15" },
    scopes: { Model: "Family" },
    formulas: { Model: "None" },
    storageTypes: { Model: "String" },
  },
];
const REFUSED = "1 cell key(s) name no type of a family loaded in this Work's scope";

function Matrix() {
  const cells: Record<string, FamilyCellState> = {};
  const { columns } = useFamiliesColumns({
    familyState: () => ({ word: "", tone: "mute", note: "" }),
    params: PARAMS,
    showUncommon: true,
    totalFamilies: 1,
    cells,
    wire: { segment: "cells", revision: 1, write: async () => null },
    // The door refuses the write: nothing lands in Work.
    propose: async () => refuse("not-ready", REFUSED),
  });
  return <Table rows={ROWS} columns={columns} rowKey={(r) => r.key} label="families" />;
}

test("a refused cell edit goes back to its drawn value and says the refusal on the cell", async () => {
  const view = render(<Matrix />);
  const input = view.container.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  expect(input.value).toBe("FXMQ15");
  await act(async () => fireEvent.change(input, { target: { value: "FXMQ20" } }));
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(input.value).toBe("FXMQ15");
  expect(view.container.textContent).toContain(REFUSED);
});
