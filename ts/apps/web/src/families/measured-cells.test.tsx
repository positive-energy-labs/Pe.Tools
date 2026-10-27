// @vitest-environment jsdom
/**
 * `/families` reads the PROJECT, so a measured cell there shows and stages the project's unit. A
 * family value is written in the unit grammar ("300 CFM"), so that literal IS what is edit.
 */
import { type FamilyCellState } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { TooltipProvider } from "@pe/kit/lang/tooltip";
import { Table } from "@pe/kit/table/table";

import { ParamCell, useLiveCells, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const PARAMETER = "Air Flow";
const CFM = {
  specTypeId: "autodesk.spec.aec:airFlow-2.0.0",
  typeId: "autodesk.unit.unit:cubicFeetPerMinute-1.0.1",
  label: "Cubic feet per minute",
  symbol: "CFM",
};
const FEET = {
  specTypeId: "autodesk.spec.aec:length-2.0.0",
  typeId: "autodesk.unit.unit:feetFractionalInches-1.0.1",
  label: "Feet and fractional inches",
  symbol: "'",
};
const param = (displayUnit: ParamColumn["displayUnit"]): ParamColumn => ({
  key: PARAMETER,
  name: PARAMETER,
  kind: "FamilyParameter",
  isInstance: false,
  isBuiltIn: false,
  isProjectOnly: false,
  familyCount: 1,
  displayUnit,
});
const ROWS: TypeRow[] = [
  {
    key: "Price LBP15A Exhaust::12 X 4",
    familyId: 1,
    familyName: "Price LBP15A Exhaust",
    categoryName: "Air Terminals",
    typeName: "12 X 4",
    typeCount: 1,
    values: { [PARAMETER]: "100 CFM" },
    scopes: { [PARAMETER]: "Family" },
    formulas: { [PARAMETER]: "None" },
    storageTypes: { [PARAMETER]: "Double" },
  },
];

const matrix = (
  displayUnit: ParamColumn["displayUnit"],
  propose: (...args: never[]) => Promise<null>,
  parse: unknown = vi.fn(async () => null),
  rows = ROWS,
  parameters = [param(displayUnit)],
  initialCells: Record<string, FamilyCellState> = {},
) => {
  function Matrix({ cells }: { cells: Record<string, FamilyCellState> }) {
    const live = useLiveCells(cells, { segment: "cells", revision: 1, write: async () => null });
    return (
      <Table
        rows={rows}
        columns={[
          {
            key: PARAMETER,
            label: PARAMETER,
            cell: (row: TypeRow) => (
              <ParamCell
                row={row}
                col={parameters[0]!}
                live={live}
                propose={propose as never}
                parse={parse as never}
              />
            ),
          },
        ]}
        rowKey={(row) => row.key}
        label="families"
      />
    );
  }
  const view = render(
    <TooltipProvider delay={0}>
      <Matrix cells={initialCells} />
    </TooltipProvider>,
  );
  return {
    view,
    input: view.container.querySelector<HTMLInputElement>("input.dl-cell-input")!,
    updateCells: (cells: Record<string, FamilyCellState>) =>
      view.rerender(
        <TooltipProvider delay={0}>
          <Matrix cells={cells} />
        </TooltipProvider>,
      ),
  };
};

const type = async (input: HTMLInputElement, text: string) => {
  await act(async () => fireEvent.change(input, { target: { value: text } }));
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
};

test("a bare number stages the project's unit with it and never calls Revit", async () => {
  const propose = vi.fn(async () => null);
  const parse = vi.fn(async () => null);
  const { input } = matrix(CFM, propose, parse);
  await type(input, "300");
  expect(parse).not.toHaveBeenCalled();
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "300", unit: "CFM", storageType: "Double" },
    "100 CFM",
  );
});

test("a measured parameter with no reported display unit is locked with a reason", async () => {
  const propose = vi.fn(async () => null);
  const { input, view } = matrix({ specTypeId: CFM.specTypeId }, propose);
  expect(input).toBeNull();
  expect(propose).not.toHaveBeenCalled();
  fireEvent.mouseEnter(view.container.querySelector("tbody [data-base-ui-tooltip-trigger]")!);
  expect((await screen.findByRole("tooltip")).textContent).toContain("cannot be edit");
});

test("the row's unit and Yes/No kind win over another family's shared column", async () => {
  const propose = vi.fn(async () => null);
  const parse = vi.fn(async () => null);
  const rows: TypeRow[] = [
    { ...ROWS[0]!, displayUnits: { [PARAMETER]: CFM }, yesNos: { [PARAMETER]: false } },
    {
      ...ROWS[0]!,
      key: "other",
      familyId: 2,
      familyName: "Other",
      values: { [PARAMETER]: "1'" },
      displayUnits: { [PARAMETER]: FEET },
      yesNos: { [PARAMETER]: false },
    },
  ];
  const { view } = matrix(CFM, propose, parse, rows);
  const inputs = view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input");
  await type(inputs[1]!, "2");
  expect(propose).toHaveBeenCalledWith(
    expect.objectContaining({ familyName: "Other" }),
    { value: "2", unit: "'", storageType: "Double" },
    "1'",
  );
});

test("ElementId cells are visibly locked with a specific reason", async () => {
  const propose = vi.fn(async () => null);
  const row: TypeRow = { ...ROWS[0]!, storageTypes: { [PARAMETER]: "ElementId" } };
  const { input, view } = matrix(null, propose, undefined, [row]);
  expect(input).toBeNull();
  fireEvent.mouseEnter(view.container.querySelector("tbody [data-base-ui-tooltip-trigger]")!);
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "cannot safely select that element",
  );
  expect(propose).not.toHaveBeenCalled();
});

test("formula and project-bound cells explain why typing is refused", async () => {
  const propose = vi.fn(async () => null);
  for (const [change, reason] of [
    [{ formulas: { [PARAMETER]: "Present" } }, "Driven by a formula"],
    [{ scopes: { [PARAMETER]: "ProjectBindingOnly" } }, "Bound at the PROJECT"],
  ] as const) {
    const { view, input } = matrix(null, propose, undefined, [{ ...ROWS[0]!, ...change }]);
    expect(input).toBeNull();
    fireEvent.mouseEnter(view.container.querySelector("tbody [data-base-ui-tooltip-trigger]")!);
    expect((await screen.findByRole("tooltip")).textContent).toContain(reason);
    view.unmount();
  }
  expect(propose).not.toHaveBeenCalled();
});
