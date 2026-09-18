// @vitest-environment jsdom
/** The listed keys hold in every CellSelect variant: edit from the td, commit, Escape back, a/d/u. */
import { useMemo, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import type { CellWire } from "#/components/lang/band";
import { MasterTable } from "#/components/master-table/master-table";

import { applyPatches } from "./band-matrix";
import {
  parameterColumn,
  STORAGE_CELLS,
  STORAGE_ROWS,
  VARIANTS,
  variantColumn,
} from "./cell-select-variants";

afterEach(cleanup);

let latest: Record<string, unknown> = {};

function Specimen() {
  const [cells, setCells] = useState(STORAGE_CELLS);
  latest = cells;
  const wire = useMemo<CellWire>(
    () => ({
      segment: "cells",
      revision: null,
      write: async (patches) => {
        setCells((current) => applyPatches(current, patches));
        return null;
      },
    }),
    [],
  );
  const columns = [
    parameterColumn,
    ...VARIANTS.map((v) => variantColumn(v.key, v.label, cells, wire)),
  ];
  return <MasterTable rows={STORAGE_ROWS} columns={columns} rowKey={(r) => r.key} scopeLabel="p" />;
}

/** The td of a row's variant column: parameter is column 0, then A, B, C. */
const td = (row: string, variant: 0 | 1 | 2) => {
  const index = STORAGE_ROWS.findIndex((r) => r.key === row);
  const tr = document.querySelectorAll("tbody tr")[index]!;
  return tr.querySelectorAll<HTMLElement>('td[role="gridcell"]')[variant + 1]!;
};

test("A · native: Enter focuses the select, a change stages, Escape returns to the td", async () => {
  render(<Specimen />);
  const cell = td("Phase", 0);
  await act(async () => cell.focus());
  await act(async () => fireEvent.keyDown(cell, { key: "Enter" }));
  const select = cell.querySelector("select")!;
  expect(document.activeElement).toBe(select);
  await act(async () => fireEvent.change(select, { target: { value: "Double" } }));
  expect(latest.Phase).toMatchObject({ staged: { value: "Double" } });
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
  expect(document.activeElement).toBe(td("Phase", 0));
});

test("C · inline: typing completes, Enter commits, Escape restores and returns to the td", async () => {
  render(<Specimen />);
  const cell = td("Model", 2);
  await act(async () => cell.focus());
  await act(async () => fireEvent.keyDown(cell, { key: "Enter" }));
  const input = cell.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  input.value = "in";
  input.setSelectionRange(2, 2);
  await act(async () => fireEvent.input(input));
  expect(input.value).toBe("Integer");
  await act(async () => fireEvent.keyDown(input, { key: "ArrowDown" }));
  expect(input.value).toBe("Double");
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(latest.Model).toMatchObject({ staged: { value: "Double" } });

  const other = td("Manufacturer", 2);
  await act(async () => other.focus());
  await act(async () => fireEvent.keyDown(other, { key: "Enter" }));
  const second = other.querySelector("input")!;
  second.value = "Elem";
  await act(async () => fireEvent.keyDown(second, { key: "Escape" }));
  expect(second.value).toBe("String");
  expect(document.activeElement).toBe(td("Manufacturer", 2));
});

test("a / d / u work on a proposal cell in every variant column, and each moves all three", async () => {
  render(<Specimen />);
  for (const [variant, key, row] of [
    [0, "a", "Voltage"],
    [1, "d", "Airflow"],
    [2, "u", "MCA"],
  ] as const) {
    const cell = td(row, variant);
    await act(async () => cell.focus());
    await act(async () => fireEvent.keyDown(cell, { key, code: `Key${key.toUpperCase()}` }));
  }
  expect(latest.Voltage).toMatchObject({ staged: { value: "Integer" } });
  expect(latest.Airflow).toMatchObject({ proposal: null });
  expect(latest.MCA).toMatchObject({ staged: null });
  // The same row in the other columns shows the accepted value.
  expect(td("Voltage", 2).querySelector("input")!.value).toBe("Integer");
});
