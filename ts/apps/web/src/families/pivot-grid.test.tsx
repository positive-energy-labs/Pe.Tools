// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";

import { TypeGrid, identityWidth } from "#/families/pivot-grid";
import { applyFamiliesQuery, buildPivot, type PivotRow } from "#/families/pivot";
import type { ParamColumn, TypeRow } from "#/families/matrix-columns";
import type { FamilySnapshotRecord } from "#/host/loaded-families-view";

const param = (key: string): ParamColumn => ({
  key,
  name: key,
  kind: "FamilyParameter",
  isInstance: false,
  isBuiltIn: false,
  isProjectOnly: false,
  familyCount: 1,
});
const type = (
  familyName: string,
  typeName: string,
  values: Record<string, string>,
  scopes: TypeRow["scopes"],
): TypeRow => ({
  key: `${familyName}:${typeName}`,
  familyId: 1,
  familyName,
  categoryName: "Air Terminals",
  typeName,
  typeCount: 1,
  values,
  scopes,
  formulas: {},
  storageTypes: Object.fromEntries(Object.keys(scopes).map((key) => [key, "String"])),
});
const family = (name: string, typeNames: string[]) =>
  ({
    familyName: name,
    typeNames,
    categoryName: "Air Terminals",
    placedInstanceCount: 1,
  }) as FamilySnapshotRecord;

test("!empty and numeric clauses count only shown types; whitespace is empty but 0 and No are filled", () => {
  const types = [
    type("A", "one", { w: "  " }, { w: "Family" }),
    type("A", "two", { w: "No" }, { w: "Family" }),
    type("B", "one", { w: "0", flow: "30 CFM" }, { w: "Family", flow: "Family" }),
  ];
  const { pivotRows, pivotFamilies } = buildPivot(
    types,
    [param("w"), param("flow")],
    [family("A", ["one", "two"]), family("B", ["one"])],
  );
  expect(
    applyFamiliesQuery("!empty family~A", pivotRows, pivotFamilies).shownRows.map((row) => [
      row.key,
      row.families,
      row.filled,
      row.present,
    ]),
  ).toEqual([["w", 1, 1, 2]]);
  expect(
    applyFamiliesQuery("!empty family~B", pivotRows, pivotFamilies).shownRows.map((row) => [
      row.key,
      row.filled,
    ]),
  ).toEqual([
    ["w", 1],
    ["flow", 1],
  ]);
  expect(applyFamiliesQuery("filled>=2 family~A", pivotRows, pivotFamilies).shownRows).toEqual([]);
  expect(
    applyFamiliesQuery("fams>=2", pivotRows, pivotFamilies).shownRows.map((row) => row.key),
  ).toEqual(["w"]);
  // `!` negates a rule; a family clause narrows the type columns, and rows recount over them.
  const names = (query: string) => {
    const shown = applyFamiliesQuery(query, pivotRows, pivotFamilies);
    return [shown.shownFamilies.map((each) => each.name), shown.shownRows.map((row) => row.key)];
  };
  expect(names("family!=B !absent")).toEqual([["A"], ["w"]]);
  expect(names("parameter=flow !valueless")).toEqual([["B"], ["flow"]]);
});

test("511 type columns mount a bounded window and expose direct editable cells", async () => {
  const params = Array.from({ length: 377 }, (_, i) => param(`p${i}`));
  const scopes = Object.fromEntries(
    params.map((entry) => [entry.key, "Family"]),
  ) as TypeRow["scopes"];
  const values = Object.fromEntries(params.map((entry) => [entry.key, "No"]));
  const types = Array.from({ length: 511 }, (_, i) => type("A", `type ${i}`, values, scopes));
  const rows: PivotRow[] = params.map((entry) => ({
    key: entry.key,
    name: entry.name,
    kind: entry.kind,
    families: 1,
    filled: 511,
    present: 511,
    filledByFamily: {},
    typesByFamily: {},
  }));
  const scroller = { current: null };
  const propose = vi.fn(async () => null);
  const view = render(
    <TypeGrid
      rows={rows}
      types={types}
      families={[{ name: "A", category: "Air Terminals", types: 511, placed: 1, params: 377 }]}
      edit={{
        params: new Map(params.map((entry) => [entry.key, entry])),
        live: {
          cells: {},
          wire: { segment: "cells", revision: 1, write: async () => null },
          listeners: new Set(),
        },
        propose,
        readOnly: false,
      }}
      scroller={scroller}
    />,
  );
  expect(
    view.getByRole("grid", { name: "parameters × family types" }).getAttribute("aria-colcount"),
  ).toBe("512");
  expect(view.container.querySelectorAll('[role="gridcell"]').length).toBeLessThan(500);
  expect(view.getAllByRole("rowheader").length).toBe(
    view.container.querySelectorAll("[aria-rowindex]").length,
  );
  expect(view.getByRole("button", { name: "Metadata for p0" })).not.toBeNull();
  const input = view.container.querySelector<HTMLInputElement>(
    '[aria-label="p0 · A · type 0"] input',
  )!;
  expect(input).not.toBeNull();
  await act(async () => fireEvent.change(input, { target: { value: "Yes" } }));
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(propose).toHaveBeenCalledWith(
    { familyName: "A", typeName: "type 0", parameter: "p0" },
    { value: "Yes", storageType: "String" },
    "No",
  );

  const grid = view.getByRole("grid", { name: "parameters × family types" });
  Object.defineProperties(grid, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 500 },
    scrollTo: {
      configurable: true,
      value: ({ left, top }: { left: number; top: number }) => {
        grid.scrollLeft = left;
        grid.scrollTop = top;
        fireEvent.scroll(grid);
      },
    },
  });
  await act(async () => {
    grid.scrollLeft = identityWidth + 500 * 112;
    fireEvent.scroll(grid);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(view.getByRole("columnheader", { name: "A · type 500" })).not.toBeNull();
  expect(view.container.querySelector<HTMLElement>('[title="A"]')?.style.left).toBe(
    `${grid.scrollLeft + identityWidth}px`,
  );
  expect(view.container.querySelector('[aria-label="p0 · A · type 500"] input')).not.toBeNull();
  expect(view.container.querySelectorAll('[role="gridcell"]').length).toBeLessThan(500);

  await act(async () => {
    grid.scrollLeft = identityWidth + 250 * 112;
    fireEvent.scroll(grid);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const horizontalEdge = view.container.querySelector<HTMLInputElement>(
    '[aria-label="p0 · A · type 261"] input',
  )!;
  expect(horizontalEdge).not.toBeNull();
  horizontalEdge.focus();
  await act(async () => {
    fireEvent.keyDown(horizontalEdge, { key: "Tab" });
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(document.activeElement?.closest('[aria-label="p0 · A · type 262"]')).not.toBeNull();
  expect(grid.scrollLeft).toBeGreaterThan(identityWidth + 250 * 112);

  await act(async () => {
    grid.scrollLeft = 0;
    grid.scrollTop = 0;
    fireEvent.scroll(grid);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const edgeInput = view.container.querySelector<HTMLInputElement>(
    '[aria-label="p21 · A · type 0"] input',
  )!;
  expect(edgeInput).not.toBeNull();
  edgeInput.focus();
  await act(async () => {
    fireEvent.keyDown(edgeInput, { key: "ArrowDown" });
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(document.activeElement?.closest('[aria-label="p22 · A · type 0"]')).not.toBeNull();
  expect(grid.scrollTop).toBeGreaterThan(0);
  view.unmount();
});

test("archived type cells render the saved value without edit controls", () => {
  const row: PivotRow = {
    key: "w",
    name: "Width",
    kind: "FamilyParameter",
    families: 1,
    filled: 1,
    present: 1,
    filledByFamily: { A: 1 },
    typesByFamily: {},
  };
  const view = render(
    <TypeGrid
      rows={[row]}
      types={[type("A", "one", { w: "No" }, { w: "Family" })]}
      families={[{ name: "A", category: "Air Terminals", types: 1, placed: 1, params: 1 }]}
      edit={{
        params: new Map([["w", param("w")]]),
        live: {
          cells: {},
          wire: { segment: "cells", revision: 1, write: async () => null },
          listeners: new Set(),
        },
        propose: vi.fn(async () => null),
        readOnly: true,
      }}
      scroller={{ current: null }}
    />,
  );
  const cell = view.getByRole("gridcell", { name: "Width · A · one" });
  expect(cell.textContent).toContain("No");
  expect(cell.querySelector("input")).toBeNull();
  view.unmount();
});
