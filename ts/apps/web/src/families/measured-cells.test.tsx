// @vitest-environment jsdom
/**
 * `/families` reads the PROJECT, so a measured cell there shows and stages the project's unit. A
 * family value is written in the unit grammar ("300 CFM"), so that literal IS what is staged.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Table } from "#/components/master-table/table";

import { useFamiliesColumns, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const PARAMETER = "Air Flow";
const CFM = {
  specTypeId: "autodesk.spec.aec:airFlow-2.0.0",
  typeId: "autodesk.unit.unit:cubicFeetPerMinute-1.0.1",
  label: "Cubic feet per minute",
  symbol: "CFM",
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
) => {
  function Matrix() {
    const { columns } = useFamiliesColumns({
      familyState: () => ({ word: "", tone: "mute", note: "" }),
      params: [param(displayUnit)],
      showUncommon: true,
      totalFamilies: 1,
      cells: {},
      wire: { segment: "cells", revision: 1, write: async () => null },
      propose: propose as never,
      parse: parse as never,
    });
    return <Table rows={ROWS} columns={columns} rowKey={(r) => r.key} label="families" />;
  }
  const view = render(<Matrix />);
  return { view, input: view.container.querySelector<HTMLInputElement>("input.dl-cell-input")! };
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

test("a measured parameter the project shows no unit for asks at the cell and stages nothing", async () => {
  const propose = vi.fn(async () => null);
  const { input, view } = matrix({ specTypeId: CFM.specTypeId }, propose);
  await type(input, "300");
  expect(propose).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain("type a unit");
});
