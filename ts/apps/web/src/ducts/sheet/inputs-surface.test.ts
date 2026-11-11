// @vitest-environment jsdom
import {
  ductsInputsSchema,
  ductsSheetEditsSchema,
  type DuctsInputs,
  type Resolved,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { snapshot as networkSnapshot } from "../test-fixture";
import {
  InputsSurface,
  ENGINE_DEFAULT_NO_SHARED_ROOT,
  NO_SHARED_ROOT,
  inputFields,
  protocolPickers,
  type InputContext,
  type InputsHistory,
} from "./inputs-surface";
import { EMPTY_SNAPSHOT } from "./scoped-snapshot";

const firm = <T>(value: T): Resolved<T> => ({
  value,
  source: "firm",
  ref: "seed",
  units: null,
  version: null,
  status: "valid",
});
const inputs = (): DuctsInputs =>
  ductsInputsSchema.parse({
    criteria: {
      velocityLimitFpm: { supply: firm(900), return: firm(700) },
      terminalDropInWg: firm(0.03),
      autoJoinGapIn: firm(3),
      healBoxIn: firm(36),
      splitPolicy: firm("even"),
      allowanceInWg: { supply: firm(0), return: firm(0.1) },
    },
    terminals: {},
    units: {},
    components: {},
    tables: {},
    assignments: {},
    fittingDrops: {},
    rulings: { joins: [], ends: [] },
  });
const context = (): Omit<InputContext, "inputs"> & { inputs: DuctsInputs } => ({
  snapshot: { ...EMPTY_SNAPSHOT, nodes: [13760867, 7, 1, 2].map(id => ({
    ...networkSnapshot.nodes[0]!, id, uniqueId: `fixture:${id}`,
    kind: id === 7 ? "terminal" as const : "equipment" as const,
  })) },
  doc: null,
  revision: 3,
  sheet: null,
  inputs: inputs(),
  firm: { version: "seed", path: "Firm/ducts.json", present: false },
  slots: [{ slot: "Airflow", covered: 3, total: 4 }],
  activeSlot: "Airflow",
  element: null,
  fittings: [],
});

it("puts the model/walked conflict in the fan airflow cell without changing its authored value", () => {
  const ctx = context();
  ctx.inputs!.units["13760867"] = {
    cfm: { ...firm(1200), source: "model", ref: "PE_M_Fan_AirFlow" },
    esp: firm(null),
    role: firm("fan"),
    kind: firm("fan-coil"),
  };
  ctx.sheet = {
    overview: { fan: { unitId: 13760867 } },
    inputs: {
      notes: [
        {
          kind: "flow-conflict",
          text: "fan 13760867: 1200 cfm (model:PE_M_Fan_AirFlow) conflicts with 942 cfm (walked end sum); 2 open ends",
        },
      ],
    },
  };
  const row = inputFields(ctx).rows.find((r) => r.key === "unit:13760867:cfm")!;
  expect(row.control).toMatchObject({ value: 1200 });
  expect(row.source).toBe(
    "Conflict: 1200 cfm (model:PE_M_Fan_AirFlow) conflicts with 942 cfm (walked end sum); 2 open ends",
  );
  const view = render(
    createElement(InputsSurface, {
      ctx,
      busy: false,
      elementName: null,
      onSlot: vi.fn(),
      apply: vi.fn(),
      nameOf: () => "FC-23",
      history: {
        undoLabel: null,
        redoLabel: null,
        last: null,
        cleared: null,
        undo: vi.fn(),
        redo: vi.fn(),
        restore: vi.fn(),
      },
    }),
  );
  const source = view.getByText(row.source);
  expect(source.closest('[data-input-field="unit:13760867:cfm"]')).not.toBeNull();
  expect(source.className).toContain("whitespace-normal");
});

it("orders the project criteria and carries source chips from the resolved values", () => {
  const ctx = context();
  ctx.inputs!.criteria.autoJoinGapIn = {
    value: 4,
    source: "Work",
    units: null,
    version: null,
    status: "valid",
  };
  const rows = inputFields(ctx).criteria;
  expect(rows.map((r) => r.key)).toEqual([
    "velocityLimitFpm:supply",
    "velocityLimitFpm:return",
    "terminalDropInWg",
    "autoJoinGapIn",
    "healBoxIn",
    "splitPolicy",
    "allowanceInWg:supply",
    "allowanceInWg:return",
  ]);
  expect(rows[0]).toMatchObject({ value: 900, source: "firm seed", unit: "fpm" });
  expect(rows[3]).toMatchObject({ value: 4, source: "Work", unit: "in" });
});

it("edits criteria through the contract, writing and clearing only the edited side of a pair", () => {
  const rows = inputFields(context()).criteria;
  const velocity = rows.find((r) => r.key === "velocityLimitFpm:supply")!;
  const allowance = rows.find((r) => r.key === "allowanceInWg:return")!;
  const split = rows.find((r) => r.kind === "split")!;
  if (velocity.kind !== "number" || allowance.kind !== "number" || split.kind !== "split")
    throw new Error("Missing criterion control");
  expect(ductsSheetEditsSchema.parse(velocity.edit(800))).toEqual({
    criteria: { velocityLimitFpm: { supply: 800 } },
  });
  expect(ductsSheetEditsSchema.parse(allowance.edit(0.2))).toEqual({
    criteria: { allowanceInWg: { return: 0.2 } },
  });
  expect(ductsSheetEditsSchema.parse(velocity.edit(null))).toEqual({
    criteria: { velocityLimitFpm: { supply: null } },
  });
  expect(split.edit("proportional")).toEqual({ criteria: { splitPolicy: "proportional" } });
  for (const row of rows)
    expect(
      ductsSheetEditsSchema.safeParse(
        row.kind === "number" ? row.edit(row.value) : row.edit(row.value),
      ).success,
    ).toBe(true);
});

it("protocol: the fan-flow slot is a picker beside the terminal one, its candidates covered over the walk's units", () => {
  // Chadds (2026-10-29): the C# default PE_M_Fan_AirFlowDesign is empty on every unit; the model's
  // design flows are in PE_M_Fan_AirFlow.
  const unit = (id: number): DuctSnapshot["nodes"][number] => ({
    ...networkSnapshot.nodes[0]!,
    id,
    kind: "equipment",
    connectors: [],
    facts: [],
    flowParameter: null,
  });
  const snapshot: DuctSnapshot = {
    ...EMPTY_SNAPSHOT,
    slots: { ...EMPTY_SNAPSHOT.slots, fanFlow: "PE_M_Fan_AirFlowDesign", terminalFlow: "Airflow" },
    nodes: [unit(1), unit(2), unit(3)],
    fanFlowCandidates: [
      { slot: "PE_M_Fan_AirFlow", where: "instance", shared: true, have: 3, of: 3, groups: [] },
      {
        slot: "PE_M_Fan_AirFlowDesign",
        where: "instance",
        shared: true,
        have: 0,
        of: 3,
        groups: [],
      },
    ],
  };
  const [terminal, fan] = protocolPickers({ ...context(), snapshot });
  expect(terminal).toMatchObject({ key: "terminalFlow", current: "Airflow" });
  expect(fan).toMatchObject({ key: "fanFlow", current: "PE_M_Fan_AirFlowDesign", noun: "units" });
  expect(fan!.options.map((o) => [o.slot, o.have, o.of])).toEqual([
    ["PE_M_Fan_AirFlow", 3, 3],
    ["PE_M_Fan_AirFlowDesign", 0, 3],
  ]);
});

afterEach(cleanup);
it("F8 groups fittings into one table choice with an explicit expandable member census", () => {
  const ctx = context();
  ctx.sheet = { overview: { fan: null }, inputs: null };
  ctx.fittings = Array.from({ length: 50 }, (_, i) => ({
    key: String(i + 1), elementId: i + 1, family: "Rectangular elbow",
    rule: null, table: null, ruleSource: "none", tableSource: null,
    options: [], candidates: [], lossInWg: null, unpriced: "Choose a rule", typed: null,
  }));
  const view = render(createElement(InputsSurface, {
    ctx, busy: false, elementName: null, onSlot: vi.fn(), apply: vi.fn(), nameOf: String,
    history: { undoLabel: null, redoLabel: null, last: null, cleared: null,
      undo: vi.fn(), redo: vi.fn(), restore: vi.fn() },
  }));
  expect(view.container.querySelectorAll("[data-fitting-group]")).toHaveLength(1);
  expect(view.container.querySelectorAll("[data-fitting]")).toHaveLength(0);
  expect(view.getByText("50 not priced")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Show the 50 fittings" }));
  expect(view.container.querySelectorAll("[data-fitting]")).toHaveLength(50);
  fireEvent.click(view.getByRole("button", { name: "Hide the 50 fittings" }));
  expect(view.container.querySelectorAll("[data-fitting]")).toHaveLength(0);
});
it.each(["terminal:7:cfm", "join:1:0|2:0"])(
  "cleared %s keeps Restore under typed-only until the next edit",
  (rowKey) => {
    const ctx = context();
    ctx.sheet = { overview: { fan: null }, inputs: null };
    ctx.inputs!.terminals["7"] = {
      cfm: { value: 80, source: "model", units: null, version: null, status: "valid" },
      drop: firm(0.03),
    };
    const restore = vi.fn();
    const history: InputsHistory = {
      undoLabel: "clear",
      redoLabel: null,
      last: null,
      cleared: { press: "clear-1", rowKey, was: "100 cfm" },
      undo: vi.fn(),
      redo: vi.fn(),
      restore,
    };
    const props = {
      ctx,
      busy: false,
      elementName: null,
      onSlot: vi.fn(),
      apply: vi.fn(),
      history,
      nameOf: () => "DS-1",
    };
    const view = render(createElement(InputsSurface, props));
    fireEvent.click(view.getByRole("button", { name: "Show typed inputs only" }));
    const button = view.getByRole("button", { name: "Restore 100 cfm" });
    expect(
      button.closest(rowKey.startsWith("terminal") ? "[data-input-field]" : "[data-inputs-orphan]"),
    ).not.toBeNull();
    fireEvent.click(button);
    expect(restore).toHaveBeenCalledWith("clear-1");
    view.rerender(
      createElement(InputsSurface, {
      ...props, history: { ...history, cleared: null } }),
    );
    expect(view.queryByRole("button", { name: "Restore 100 cfm" })).toBeNull();
  },
);

it("labels the undoable row action Revert and records the same History name", () => {
  const ctx = context();
  ctx.sheet = { overview: { fan: null }, inputs: null };
  ctx.inputs!.terminals["7"] = { cfm: { ...firm(100), source: "Work" }, drop: firm(0.03) };
  const apply = vi.fn();
  const { getAllByRole } = render(
    createElement(InputsSurface, {
      ctx,
      apply,
      busy: false,
      elementName: null,
      onSlot: vi.fn(),
      nameOf: () => "Terminal",
      history: {
        undoLabel: null,
        redoLabel: null,
        last: null,
        cleared: null,
        undo: vi.fn(),
        redo: vi.fn(),
        restore: vi.fn(),
      },
    }),
  );
  const button = getAllByRole("button").find((b) => b.textContent === "Revert");
  expect(button).toBeTruthy();
  expect(button!.getAttribute("aria-label")).toMatch(/^Revert /);
  fireEvent.click(button!);
  expect(apply).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ label: expect.stringMatching(/^Revert /), clear: true }),
  );
});

it("no shared root: only the firm line refuses; a criterion on the seed stays editable Work", async () => {
  const ctx = context();
  ctx.firm = { refused: "no-shared-root" };
  ctx.sheet = { overview: { fan: null }, inputs: null };
  const supply = inputFields(ctx).criteria.find((r) => r.key === "velocityLimitFpm:supply")!;
  expect(supply).toMatchObject({ value: 900, source: ENGINE_DEFAULT_NO_SHARED_ROOT });
  const apply = vi.fn();
  const view = render(
    createElement(InputsSurface, {
      ctx, busy: false, elementName: null, onSlot: vi.fn(), apply, nameOf: String,
      history: { undoLabel: null, redoLabel: null, last: null, cleared: null,
        undo: vi.fn(), redo: vi.fn(), restore: vi.fn() },
    }),
  );
  expect(view.container.querySelector("[data-inputs-firm-refused='no-shared-root']")?.textContent).toBe(NO_SHARED_ROOT);
  const field = view.container.querySelector("[data-input-field='velocityLimitFpm:supply']")!;
  expect(field.querySelector("[data-body='locked']")).toBeNull();
  expect(field.textContent).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  const input = field.querySelector("input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "800" } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter", code: "Enter" }));
  expect(apply).toHaveBeenCalledWith(
    { criteria: { velocityLimitFpm: { supply: 800 } } },
    expect.objectContaining({ rowKey: "velocityLimitFpm:supply" }),
  );
});
