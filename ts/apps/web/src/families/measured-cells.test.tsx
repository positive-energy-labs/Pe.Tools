// @vitest-environment jsdom
/**
 * `/families` reads the PROJECT, so a measured cell there shows and stages the project's unit. A
 * family value is written in the unit grammar ("300 CFM"), so that literal IS what is staged.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { familyCellKey, type FamilyCellState } from "@pe/agent-contracts";

import { Table } from "#/components/master-table/table";

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
  const view = render(<Matrix cells={initialCells} />);
  return {
    view,
    input: view.container.querySelector<HTMLInputElement>("input.dl-cell-input")!,
    updateCells: (cells: Record<string, FamilyCellState>) =>
      view.rerender(<Matrix cells={cells} />),
  };
};

test("the direct cell subscription redraws the changed Work value", () => {
  const propose = vi.fn(async () => null);
  const { view, updateCells } = matrix(CFM, propose);
  expect(view.container.querySelector<HTMLInputElement>("input.dl-cell-input")?.value).toBe(
    "100 CFM",
  );
  const key = familyCellKey({
    familyName: ROWS[0]!.familyName,
    typeName: ROWS[0]!.typeName,
    parameter: PARAMETER,
  });
  updateCells({
    [key]: {
      proposal: null,
      staged: { value: { value: "200", unit: "CFM", storageType: "Double" } },
    },
  });
  expect(view.container.querySelector<HTMLInputElement>("input.dl-cell-input")?.value).toBe(
    "200 CFM",
  );
});

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

test("typed text is Revit's to read, and Revit's answer is what is staged", async () => {
  const propose = vi.fn(async () => null);
  const parse = vi.fn(async () => ({ value: "635.66", unit: "CFM" }));
  const { input } = matrix(CFM, propose, parse);
  await type(input, "300 L/s");
  expect(parse).toHaveBeenCalledWith(CFM, "300 L/s");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "635.66", unit: "CFM", storageType: "Double" },
    "100 CFM",
  );
});

test("a measured parameter with no reported display unit is locked with a reason", () => {
  const propose = vi.fn(async () => null);
  const { input, view } = matrix({ specTypeId: CFM.specTypeId }, propose);
  expect(input).toBeNull();
  expect(propose).not.toHaveBeenCalled();
  expect(view.container.innerHTML).toContain("cannot be staged");
});

test("feet, inches and fractions go to Revit; its exact answer is staged", async () => {
  const propose = vi.fn(async () => null);
  const parse = vi.fn(async () => ({ value: "1.5416666666666667", unit: "'" }));
  const { input } = matrix(FEET, propose, parse);
  await type(input, "1'-6 1/2\"");
  expect(parse).toHaveBeenCalledWith(FEET, "1'-6 1/2\"");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "1.5416666666666667", unit: "'", storageType: "Double" },
    "100 CFM",
  );
});

test("metric length input and malformed units use Revit's answer and refusal", async () => {
  const propose = vi.fn(async () => null);
  const parse = vi.fn(async (_unit: unknown, text: string) =>
    text === "450 mm"
      ? { value: "1.4763779527559056", unit: "'" }
      : { refusal: "Unit 'cubits' is not valid for length." },
  );
  const { input, view } = matrix(FEET, propose, parse);
  await type(input, "12 cubits");
  expect(input.value).toBe("100 CFM");
  expect(view.container.textContent).toContain("cubits");
  expect(propose).not.toHaveBeenCalled();
  await type(input, "450 mm");
  expect(parse).toHaveBeenCalledWith(FEET, "450 mm");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "1.4763779527559056", unit: "'", storageType: "Double" },
    "100 CFM",
  );
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

test("unitless doubles and integers refuse malformed input, then accept corrected input", async () => {
  const propose = vi.fn(async () => null);
  const row: TypeRow = { ...ROWS[0]!, storageTypes: { [PARAMETER]: "Integer" } };
  const { input, view } = matrix(null, propose, undefined, [row]);
  await type(input, "12.5");
  expect(input.value).toBe("100 CFM");
  expect(view.container.textContent).toContain("whole number");
  expect(propose).not.toHaveBeenCalled();
  await type(input, "12");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "12", storageType: "Integer" },
    "100 CFM",
  );
});

test("ElementId cells are visibly locked with a specific reason", () => {
  const propose = vi.fn(async () => null);
  const row: TypeRow = { ...ROWS[0]!, storageTypes: { [PARAMETER]: "ElementId" } };
  const { input, view } = matrix(null, propose, undefined, [row]);
  expect(input).toBeNull();
  expect(view.container.innerHTML).toContain("cannot safely select that element");
  expect(propose).not.toHaveBeenCalled();
});

test("formula and project-bound cells explain why typing is refused", () => {
  const propose = vi.fn(async () => null);
  for (const [change, reason] of [
    [{ formulas: { [PARAMETER]: "Present" } }, "Driven by a formula"],
    [{ scopes: { [PARAMETER]: "ProjectBindingOnly" } }, "Bound at the PROJECT"],
  ] as const) {
    const { view, input } = matrix(null, propose, undefined, [{ ...ROWS[0]!, ...change }]);
    expect(input).toBeNull();
    expect(view.container.innerHTML).toContain(reason);
    view.unmount();
  }
  expect(propose).not.toHaveBeenCalled();
});

test("strings can be cleared; a unitless double refuses malformed text", async () => {
  const propose = vi.fn(async () => null);
  const string = { ...ROWS[0]!, storageTypes: { [PARAMETER]: "String" as const } };
  const text = matrix(null, propose, undefined, [string]);
  await type(text.input, "");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "", storageType: "String" },
    "100 CFM",
  );
  text.view.unmount();

  propose.mockClear();
  const double = matrix(null, propose);
  await type(double.input, "2 cfm");
  expect(propose).not.toHaveBeenCalled();
  expect(double.view.container.textContent).toContain("finite number");
  await type(double.input, "2.5");
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "2.5", storageType: "Double" },
    "100 CFM",
  );
});

test("Yes/No stays a closed choice and says when staging is refused", async () => {
  const propose = vi.fn(async () => ({ code: "stale", message: "Reading changed; retry." }));
  const yesNo = { ...param(null), yesNo: true };
  const row: TypeRow = {
    ...ROWS[0]!,
    values: { [PARAMETER]: "No" },
    storageTypes: { [PARAMETER]: "Integer" },
  };
  const { view, input } = matrix(null, propose as never, undefined, [row], [yesNo]);
  expect(input).toBeNull();
  fireEvent.click(view.container.querySelector("[data-cell-editor]")!);
  fireEvent.click(await screen.findByRole("option", { name: "Yes" }));
  await act(async () => {});
  expect(propose).toHaveBeenCalledWith(
    expect.anything(),
    { value: "Yes", storageType: "Integer" },
    "No",
  );
  expect(view.container.textContent).toContain("Reading changed; retry.");
  const refusal = view.container.querySelector<HTMLButtonElement>(
    'button[title="Reading changed; retry. — click to dismiss"]',
  );
  expect(refusal).not.toBeNull();
  expect(refusal?.closest("[data-cell-editor]")).toBeNull();
  expect(view.container.querySelector("[data-cell-editor]")?.getAttribute("data-tone")).toBe(
    "alarm",
  );
});
