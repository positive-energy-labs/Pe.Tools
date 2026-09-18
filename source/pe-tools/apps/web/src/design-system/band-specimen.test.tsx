// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { MasterTable } from "#/components/master-table/master-table";

import { applyPatches, MATRIX, MATRIX_CELLS } from "./band-matrix";
import { matrixColumns, matrixRows, TypeForm, type Write } from "./band-specimen";

afterEach(cleanup);

function Specimen() {
  const [cells, setCells] = useState(MATRIX_CELLS);
  const write: Write = async (patches) => {
    setCells((current) => applyPatches(current, patches));
    return null;
  };
  return (
    <>
      <MasterTable
        rows={matrixRows(cells)}
        columns={matrixColumns(write)}
        rowKey={(r) => r.key}
        scopeLabel="family types"
      />
      <section aria-label="form">
        <TypeForm row={MATRIX.find((r) => r.key === "HP-2")!} cells={cells} write={write} />
      </section>
    </>
  );
}

test("accepting in the form field changes the same cell in the table", async () => {
  const { container } = render(<Specimen />);
  const form = within(screen.getByRole("region", { name: "form" }));
  // HP-2 Voltage: an open 208V proposal; the table shows it as a proposed row-scale cell
  expect(form.getAllByRole("button", { name: "accept" })).toHaveLength(2); // Voltage, MOCP
  await act(async () => fireEvent.click(form.getAllByRole("button", { name: "accept" })[0]!));
  const staged = container.querySelectorAll('table .dl-cell[data-unsaved="pea"]');
  expect(staged).toHaveLength(1);
  expect((staged[0]!.querySelector("input") as HTMLInputElement).value).toBe("208V");
});
