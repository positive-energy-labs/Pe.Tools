// @vitest-environment jsdom
import { useMemo, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { fanOutWord, type FanOutOutcome } from "#/components/lang/band";
import { MasterTable } from "#/components/master-table/master-table";

import { applyPatches, cellKey, MATRIX, MATRIX_CELLS } from "./band-matrix";
import {
  acceptVoltage,
  MATRIX_COLUMNS,
  matrixRows,
  matrixWire,
  TypeForm,
  type Matrix,
} from "./band-specimen";

afterEach(cleanup);

let latest!: Matrix;
let said: FanOutOutcome | null = null;

function Specimen() {
  const [cells, setCells] = useState(MATRIX_CELLS);
  const wire = useMemo(
    () =>
      matrixWire(async (patches) => {
        setCells((current) => applyPatches(current, patches));
        return null;
      }),
    [],
  );
  const matrix: Matrix = (latest = { cells, wire, outcome: null });
  return (
    <>
      <MasterTable
        rows={matrixRows(matrix)}
        columns={MATRIX_COLUMNS}
        rowKey={(r) => r.key}
        scopeLabel="family types"
        actions={
          <button onClick={() => void acceptVoltage(matrix).then((o) => (said = o))}>all</button>
        }
      />
      <section aria-label="form">
        <TypeForm row={MATRIX.find((r) => r.key === "HP-2")!} matrix={matrix} />
      </section>
    </>
  );
}

test("accepting in the form field changes the same cell in the table", async () => {
  const { container } = render(<Specimen />);
  const form = within(screen.getByRole("region", { name: "form" }));
  expect(form.getAllByRole("button", { name: "accept" })).toHaveLength(2); // Voltage, MOCP
  await act(async () => fireEvent.click(form.getAllByRole("button", { name: "accept" })[0]!));
  const staged = container.querySelectorAll('table .dl-cell[data-unsaved="pea"]');
  expect(staged).toHaveLength(1);
  expect((staged[0]!.querySelector("input") as HTMLInputElement).value).toBe("208V");
});

test("the Voltage accept-all is one fanOut that leaves your contested 240V alone", async () => {
  render(<Specimen />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "all" })));
  expect(fanOutWord(said!)).toBe("accepted 11 · skipped 7 (1 contested, 6 no-proposal)");
  expect(latest.cells[cellKey("FCU-2", "Voltage")]?.staged).toEqual({ value: "240V" });
  expect(latest.cells[cellKey("FCU-1", "Voltage")]?.staged).toEqual({ value: "208V" });
});
