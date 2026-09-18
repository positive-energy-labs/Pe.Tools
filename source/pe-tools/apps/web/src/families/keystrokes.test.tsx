// @vitest-environment jsdom
/**
 * O8-c (floor: no silent loss of human work). Typing into a second matrix cell while the first
 * cell's write is in flight must survive that write landing: the text stays, and so does focus.
 * Real Table, real families columns and ProposalCell; the store is a deferred write.
 */
import { useState } from "react";
import { familyCellKey, type FamilyCellAddress, type FamilyCellState } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Table } from "#/components/master-table/table";

import { useFamiliesColumns, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const param = (key: string): ParamColumn =>
  ({
    key,
    name: key,
    kind: "FamilyParameter",
    isInstance: false,
    isBuiltIn: false,
    isProjectOnly: false,
    familyCount: 1,
  }) as ParamColumn;
const PARAMS = [param("Model")];
const row = (familyId: number, familyName: string, value: string): TypeRow => ({
  key: `${familyId}::T`,
  familyId,
  familyName,
  categoryName: "Mechanical Equipment",
  typeName: "T",
  typeCount: 1,
  values: { Model: value },
  scopes: { Model: "Family" },
  formulas: { Model: "None" },
});
const ROWS = [row(1, "Fan Coil", "FXMQ15"), row(2, "Heat Pump", "RXL24")];

let land: () => void = () => {};

function Matrix({ inlineClick = false }: { inlineClick?: boolean }) {
  const [cells, setCells] = useState<Record<string, FamilyCellState>>({});
  const { columns } = useFamiliesColumns({
    familyState: () => ({ word: "", tone: "mute", note: "" }),
    params: PARAMS,
    showUncommon: true,
    totalFamilies: 2,
    cells,
    wire: { segment: "cells", revision: 1, write: async () => null },
    // The write lands later, as Work does: only then do the cells (and the columns) change.
    propose: (address: FamilyCellAddress, value: { familyName: string; value: string }) =>
      new Promise<void>((resolve) => {
        land = () => {
          setCells((current) => ({
            ...current,
            [familyCellKey(address)]: { proposal: null, staged: { value } },
          }));
          resolve();
        };
      }) as never,
  });
  return (
    <Table
      rows={ROWS}
      columns={columns}
      rowKey={(r) => r.key}
      label="families"
      // The real matrix passes a fresh arrow each render, so every render re-renders every row.
      onRowClick={inlineClick ? () => {} : undefined}
    />
  );
}

test("O8-c: text typed into cell B while cell A's write is in flight survives A landing", async () => {
  const view = render(<Matrix inlineClick />);
  const input = (value: string) =>
    [...view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input")].find(
      (el) => el.defaultValue === value,
    )!;
  const a = input("FXMQ15");
  const b = input("RXL24");

  // Stage A: type and commit with Enter, as a person does; its write is now in flight.
  await act(async () => a.focus());
  fireEvent.change(a, { target: { value: "FXMQ20" } });
  await act(async () => fireEvent.keyDown(a, { key: "Enter" }));

  // Type into B while A is in flight.
  await act(async () => b.focus());
  fireEvent.change(b, { target: { value: "xyz" } });

  // A lands: Work changes, the matrix re-renders from it.
  await act(async () => land());

  const bNow = [...view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input")].find(
    (el) => el.defaultValue === "RXL24",
  )!;
  // The same input, not a remount that happens to be empty.
  expect(bNow).toBe(b);
  expect(bNow.value).toBe("xyz");
  expect(document.activeElement).toBe(bNow);
  // And A shows what landed.
  expect(
    [...view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input")].some(
      (el) => el.value === "FXMQ20",
    ),
  ).toBe(true);
});

test("a landed write redraws its cell even when nothing about the row changed", async () => {
  // A stable row and a stable click handler: only the columns (the Work) moved.
  const view = render(<Matrix />);
  const a = [...view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input")].find(
    (el) => el.defaultValue === "FXMQ15",
  )!;
  await act(async () => a.focus());
  fireEvent.change(a, { target: { value: "FXMQ20" } });
  await act(async () => fireEvent.keyDown(a, { key: "Enter" }));
  await act(async () => land());
  expect(view.container.querySelector("[data-staged] .dl-cell")?.getAttribute("data-unsaved")).toBe(
    "",
  );
});
