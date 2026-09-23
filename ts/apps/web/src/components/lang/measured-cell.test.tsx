// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { MeasuredValue } from "@pe/agent-contracts";

import { readMeasuredText, StateCell } from "#/components/lang/cell";
import { Table } from "#/components/master-table/table";
import { useMeasuredParse } from "#/host/measured-parse";

const { callHostRpc } = vi.hoisted(() => ({ callHostRpc: vi.fn() }));
vi.mock("#/host/client", () => ({ callHostRpc }));

afterEach(cleanup);

const CFM = {
  specTypeId: "spec:airFlow",
  typeId: "unit:cfm",
  label: "Cubic feet per minute",
  symbol: "CFM",
};
const UNITLESS = { specTypeId: "spec:airFlow" };
const FEET = {
  specTypeId: "autodesk.spec.aec:length-2.0.0",
  typeId: "autodesk.unit.unit:feetFractionalInches-1.0.1",
  label: "Feet and fractional inches",
  symbol: "'",
};

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

function ParsedCell({ stage }: { stage: (value: MeasuredValue) => void }) {
  const parse = useMeasuredParse("reading");
  return (
    <StateCell
      scale="row"
      value="12'"
      measured={{ displayUnit: FEET, parse: (text) => parse(FEET, text), stage }}
    />
  );
}

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

test("a measured column with no display unit refuses a bare number", () => {
  const decided = readMeasuredText("300", UNITLESS);
  expect(decided.kind).toBe("refuse");
  expect(decided).toMatchObject({ reason: expect.stringContaining("cannot be staged") });
  // The pure decision leaves explicit text for the parser; the matrix locks this unsupported cell.
  expect(readMeasuredText("300 L/s", UNITLESS)).toEqual({ kind: "parse", text: "300 L/s" });
});

test("blank commits nothing", () => {
  expect(readMeasuredText("  ", CFM).kind).toBe("refuse");
});

/* ── the cell ───────────────────────────────────────────────────────────────── */

test("a bare number reaches measured.stage as { value, unit }", () => {
  const parse = vi.fn(async () => null);
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  type(inputOf(container), "300");
  expect(parse).not.toHaveBeenCalled();
  expect(stage).toHaveBeenCalledWith({ value: "300", unit: "CFM" });
});

test("typed text shows as typed until Revit answers, then Revit's value is what is staged", async () => {
  const answer: MeasuredValue = { value: "635.7", unit: "CFM" };
  const parse = vi.fn(async () => answer);
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  const input = inputOf(container);
  type(input, "300 L/s");
  expect(input.value).toBe("300 L/s"); // as typed, until the answer arrives
  expect(stage).not.toHaveBeenCalled();
  await act(async () => {});
  expect(parse).toHaveBeenCalledWith("300 L/s");
  expect(stage).toHaveBeenCalledWith(answer);
});

test("a refusal is cell-local, carries Revit's reason and stages nothing", async () => {
  const parse = vi.fn(async () => ({ refusal: "Revit could not read 'aaa' here." }));
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="12 CFM" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  const input = inputOf(container);
  type(input, "aaa");
  await act(async () => {});
  expect(stage).not.toHaveBeenCalled();
  expect(input.value).toBe("12 CFM"); // restored, visibly
  expect(container.textContent).toContain("Revit could not read 'aaa' here.");
});

test("a bare number in a column with no display unit refuses at the cell", () => {
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell
      scale="row"
      value=""
      measured={{ displayUnit: UNITLESS, parse: vi.fn(async () => null), stage }}
    />,
  );
  const input = inputOf(container);
  type(input, "300");
  expect(stage).not.toHaveBeenCalled();
  expect(container.textContent).toContain("cannot be staged");
});

test("a re-read cancels an in-flight parse: nothing is staged and the cell keeps what it had", async () => {
  const parse = vi.fn(async () => null); // cancelled
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="12 CFM" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  type(inputOf(container), "300 L/s");
  await act(async () => {});
  expect(stage).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("could not");
});

test("Escape cancels a pending parse and an Enter blur does not submit twice", async () => {
  let answer!: (value: MeasuredValue) => void;
  const parse = vi.fn(
    () =>
      new Promise<MeasuredValue>((resolve) => {
        answer = resolve;
      }),
  );
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="12 CFM" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  const input = inputOf(container);
  type(input, "300 L/s");
  fireEvent.blur(input);
  expect(parse).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: "Escape" });
  await act(async () => answer({ value: "635.7", unit: "CFM" }));
  expect(stage).not.toHaveBeenCalled();
  expect(input.value).toBe("12 CFM");
});

test("a virtual row unmount cancels its pending parse before staging", async () => {
  let answer!: (value: MeasuredValue) => void;
  const parse = vi.fn(
    () =>
      new Promise<MeasuredValue>((resolve) => {
        answer = resolve;
      }),
  );
  const stage = vi.fn();
  const view = inTable(
    <StateCell scale="row" value="12 CFM" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  type(inputOf(view.container), "300 L/s");
  view.unmount();
  await act(async () => answer({ value: "635.7", unit: "CFM" }));
  expect(stage).not.toHaveBeenCalled();
});

test("a later edit wins when two parses answer out of order", async () => {
  const answers = new Map<string, (value: MeasuredValue) => void>();
  const parse = vi.fn(
    (text: string) =>
      new Promise<MeasuredValue>((resolve) => {
        answers.set(text, resolve);
      }),
  );
  const stage = vi.fn();
  const { container } = inTable(
    <StateCell scale="row" value="12 CFM" measured={{ displayUnit: CFM, parse, stage }} />,
  );
  const input = inputOf(container);
  type(input, "300 L/s");
  type(input, "400 L/s");
  await act(async () => answers.get("400 L/s")!({ value: "847.5", unit: "CFM" }));
  await act(async () => answers.get("300 L/s")!({ value: "635.7", unit: "CFM" }));
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage).toHaveBeenCalledWith({ value: "847.5", unit: "CFM" });
});

test("the cell stages Revit's unrounded length instead of its rounded display text", async () => {
  const staged: MeasuredValue[] = [];
  callHostRpc.mockResolvedValueOnce({ ok: true, value: 0.4921259842519685, text: "0' - 6\"" });
  const { container } = inTable(<ParsedCell stage={(value) => staged.push(value)} />);
  type(inputOf(container), "150 mm");
  await act(async () => {});
  expect(callHostRpc).toHaveBeenCalledWith(
    "revit.resolve.unit-value",
    {
      spec: "autodesk.spec.aec:length-2.0.0",
      unit: "autodesk.unit.unit:feetFractionalInches-1.0.1",
      text: "150 mm",
    },
    expect.anything(),
  );
  expect(staged).toEqual([{ value: "0.4921259842519685", unit: "'" }]);
});

test("a host failure appears on the cell and stages nothing", async () => {
  const staged: MeasuredValue[] = [];
  callHostRpc.mockRejectedValueOnce(new Error("bridge unavailable"));
  const { container } = inTable(<ParsedCell stage={(value) => staged.push(value)} />);
  type(inputOf(container), "150 mm");
  await act(async () => {});
  expect(staged).toEqual([]);
  expect(container.textContent).toContain("bridge unavailable");
  expect(inputOf(container).value).toBe("12'");
});
