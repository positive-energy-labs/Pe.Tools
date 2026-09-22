// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { readMeasuredText, StateCell, type MeasuredValue } from "#/components/lang/cell";
import { Table } from "#/components/master-table/table";

afterEach(cleanup);

const CFM = {
  specTypeId: "spec:airFlow",
  typeId: "unit:cfm",
  label: "Cubic feet per minute",
  symbol: "CFM",
};
const UNITLESS = { specTypeId: "spec:airFlow" };

/** Row scale inside the real Table: the measured cell only exists at row scale. */
const inTable = (node: React.ReactNode) => {
  const view = render(
    <Table
      rows={[{ key: "r" }]}
      columns={[{ key: "c", label: "c", cell: () => node }]}
      rowKey={(row) => row.key}
      label="cells"
    />,
  );
  return { ...view, cell: within(view.container.querySelector<HTMLElement>(".dl-cell")!) };
};

const type = (input: HTMLInputElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};
const inputOf = (container: HTMLElement) => container.querySelector("input")!;

/* ── the decision, pure ─────────────────────────────────────────────────────── */

test("a bare number stages with the column's unit and calls nothing", () => {
  expect(readMeasuredText("300", CFM)).toEqual({
    kind: "stage",
    staged: { value: "300", unit: "CFM" },
  });
  expect(readMeasuredText(" -1.5 ", CFM)).toEqual({
    kind: "stage",
    staged: { value: "-1.5", unit: "CFM" },
  });
});

test("text carrying a unit is Revit's to read", () => {
  expect(readMeasuredText("300 L/s", CFM)).toEqual({ kind: "parse", text: "300 L/s" });
  expect(readMeasuredText("1'-6\"", CFM)).toEqual({ kind: "parse", text: "1'-6\"" });
});

test("a measured column with no display unit asks for one instead of staging a bare number", () => {
  const decided = readMeasuredText("300", UNITLESS);
  expect(decided.kind).toBe("refuse");
  expect(decided).toMatchObject({ reason: expect.stringContaining("type a unit") });
  // Typed text still goes to Revit: the document can read it even with no unit to render in.
  expect(readMeasuredText("300 L/s", UNITLESS)).toEqual({ kind: "parse", text: "300 L/s" });
});

test("blank commits nothing", () => {
  expect(readMeasuredText("  ", CFM).kind).toBe("refuse");
});

/* ── the cell ───────────────────────────────────────────────────────────────── */

test("a bare number reaches onCommit as { value, unit } with no parse call", () => {
  const parse = vi.fn(async () => null);
  const onCommit = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="" onCommit={onCommit} measured={{ displayUnit: CFM, parse }} />,
  );
  type(inputOf(container), "300");
  expect(parse).not.toHaveBeenCalled();
  expect(onCommit).toHaveBeenCalledWith({ value: "300", unit: "CFM" });
});

test("typed text shows as typed until Revit answers, then Revit's value is what is staged", async () => {
  const answer: MeasuredValue = { value: "635.7", unit: "CFM" };
  const parse = vi.fn(async () => answer);
  const onCommit = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="" onCommit={onCommit} measured={{ displayUnit: CFM, parse }} />,
  );
  const input = inputOf(container);
  type(input, "300 L/s");
  expect(input.value).toBe("300 L/s"); // as typed, until the answer arrives
  expect(onCommit).not.toHaveBeenCalled();
  await act(async () => {});
  expect(parse).toHaveBeenCalledWith("300 L/s");
  expect(onCommit).toHaveBeenCalledWith(answer);
});

test("a refusal is cell-local, carries Revit's reason and stages nothing", async () => {
  const parse = vi.fn(async () => ({ refusal: "Revit could not read 'aaa' here." }));
  const onCommit = vi.fn();
  const { container } = inTable(
    <StateCell
      scale="row"
      value="12 CFM"
      onCommit={onCommit}
      measured={{ displayUnit: CFM, parse }}
    />,
  );
  const input = inputOf(container);
  type(input, "aaa");
  await act(async () => {});
  expect(onCommit).not.toHaveBeenCalled();
  expect(input.value).toBe("12 CFM"); // restored, visibly
  expect(container.textContent).toContain("Revit could not read 'aaa' here.");
});

test("a bare number in a column with no display unit refuses at the cell", () => {
  const onCommit = vi.fn();
  const { container } = inTable(
    <StateCell
      scale="row"
      value=""
      onCommit={onCommit}
      measured={{ displayUnit: UNITLESS, parse: vi.fn(async () => null) }}
    />,
  );
  const input = inputOf(container);
  type(input, "300");
  expect(onCommit).not.toHaveBeenCalled();
  expect(container.textContent).toContain("type a unit");
});

test("a re-read cancels an in-flight parse: nothing is staged and the cell keeps what it had", async () => {
  const parse = vi.fn(async () => null); // cancelled
  const onCommit = vi.fn();
  const { container } = inTable(
    <StateCell
      scale="row"
      value="12 CFM"
      onCommit={onCommit}
      measured={{ displayUnit: CFM, parse }}
    />,
  );
  type(inputOf(container), "300 L/s");
  await act(async () => {});
  expect(onCommit).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("could not");
});
