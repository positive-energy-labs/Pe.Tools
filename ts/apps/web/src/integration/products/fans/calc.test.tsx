// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { makeAtomRegistry } from "../../../shell/owner.ts";
import { SheetPane } from "../../../route/slots/sheet/pane.tsx";
import { sheetCells } from "../../../route/slots/sheet/index.ts";
import { NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import { ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/ducts-contract/product";
import { fansCalc } from "../../../../../../products/fans/web/src/calc.ts";

/*
 * Slice 7 Delete (ruling 2026-11-10: split by owner). Each sheet stages only its own route's Work,
 * and the Fans inputs proofs that used to sit on InputsBody hold on the slot-drawn sheet.
 */
afterEach(cleanup);

test("Fans bindings stage only Fans Work", () => {
  const fansKeys = Object.keys(fansDocumentSchema.shape),
    ductsKeys = Object.keys(ductsDocumentSchema.shape);
  // Every Fans binding addresses a Fans Work key that /ducts does not own.
  // A `setting` binding stages no Work at all: it saves at a home tier (slice 6b).
  const staged = (sheet: { bindings: Readonly<Record<string, { home: { at: string } }>> }) =>
    Object.keys(sheet.bindings).filter((name) => sheet.bindings[name]!.home.at !== "setting");
  expect(Object.keys(fansCalc.bindings).length).toBeGreaterThan(staged(fansCalc).length);
  for (const binding of staged(fansCalc)) {
    expect(fansKeys, binding).toContain(binding);
    expect(binding === "writeIntent" || !ductsKeys.includes(binding), binding).toBe(true);
  }
});

const handle = (value: object, stage = vi.fn(async () => null)) => ({
  owner: { route: "fans", label: "Work" },
  refusal: null,
  value,
  freshness: "current" as const,
  transitions: () => [],
  stage,
  clear: async () => null,
});
const drawn = (
  read: object,
  doc: Record<string, unknown>,
  at: (path: readonly string[]) => object,
  only: keyof typeof fansCalc.bindings,
  state: "ready" | "refreshing" = "ready",
) => {
  const slot = { ...fansCalc, bindings: { [only]: fansCalc.bindings[only] } };
  const ctx = {
    cells: { doc, at },
    page: { read: () => ({}) },
    value: { state, value: read },
    verb: () => ({ run: async () => null, refusal: null }),
  };
  return render(
    <RegistryContext value={makeAtomRegistry()}>
      <SheetPane ctx={{ draw: ctx as never, slot }} />
    </RegistryContext>,
  );
};
const snapshot = { nodes: [], segments: [], slots: { requiredEsp: "Old ESP" } };

test("a run airflow draws work provenance on Fans", () => {
  const unit = { id: 7, kind: "equipment", uniqueId: "unit-7", connectors: [], facts: [] };
  const read = {
    calcSnapshot: { ...snapshot, nodes: [unit] },
    calcView: { inputs: { units: { "7": { cfm: { value: 1234, source: "run" } } } } },
  };
  const view = drawn(read, {}, () => handle({}), "equipmentFlows");
  expect(view.container.querySelector('[data-input-source="work"]')?.textContent).toBe("work");
});

test("a none source supplies no airflow layer, even with a retained number", () => {
  const unit = { id: 7, kind: "equipment", uniqueId: "unit-7", connectors: [], facts: [] };
  const read = {
    calcSnapshot: { ...snapshot, nodes: [unit] },
    calcView: { inputs: { units: { "7": { cfm: { value: 1234, source: "none" } } } } },
  };
  const cells = sheetCells(
    { bindings: { equipmentFlows: fansCalc.bindings.equipmentFlows } },
    { rows: [], work: {}, read },
  );
  expect(cells[0]).toMatchObject({ value: null, model: null, pending: null });
  expect(cells[0]?.source).not.toBe("none");
});

test("D25: a retained resolved Work airflow keeps Work provenance after its live edit is undone", () => {
  const unit = {
    id: 7,
    kind: "equipment",
    uniqueId: "unit-7",
    family: "MUAS",
    type: "A",
    mark: "MA-1",
    connectors: [],
    facts: [],
  };
  const row = elementSubject(unit);
  const read = {
    calcSnapshot: { ...snapshot, nodes: [unit] },
    calcView: { inputs: { units: { "7": { cfm: { value: 1234, source: "Work" } } } } },
  };
  const cells = sheetCells(
    { ...fansCalc, bindings: { equipmentFlows: fansCalc.bindings.equipmentFlows } },
    { rows: [], work: fansDocumentSchema.parse({}), read },
  );
  expect(cells.find((cell) => cell.row === row)).toMatchObject({
    value: 1234,
    source: "work",
    pending: null,
  });
  const view = drawn(read, {}, () => handle({}), "equipmentFlows", "refreshing");
  expect(view.container.querySelector('[data-input-source="work"]')?.textContent).toBe("work");
  expect(view.container.querySelector("[data-sheet-cell]")?.textContent).not.toContain("model");
  expect(view.container.textContent).toContain("1234");
});

test("ADR 0053: a receipt that disagrees with the live parameter is the cell's drift note, beside the live value", () => {
  const terminal = {
    id: 9,
    kind: "terminal",
    uniqueId: "terminal-9",
    flowParameter: "PE_Flow",
    connectors: [],
    facts: [{ key: "flow", value: 200 }],
    terminalDrop: { catalogDropInWg: 0.5 },
  };
  const slots = { ...snapshot.slots, terminalFlow: "PE_Flow", terminalDrop: "PE_Drop" };
  const inputs = {
    terminals: {
      "9": { cfm: { value: 200, source: "model" }, drop: { value: 0.5, source: "model" } },
    },
    units: {},
  };
  const read = (store: object) => ({
    calcSnapshot: { ...snapshot, slots, nodes: [terminal], store },
    calcView: { inputs },
  });
  const model = (binding: "flows" | "terminalDrops", store: object) =>
    (
      fansCalc.bindings[binding] as unknown as { model: (read: object, row: string) => object }
    ).model(read(store), elementSubject(terminal));
  const store = {
    terminalFlows: { [terminal.uniqueId]: { cfm: 150, parameter: "PE_Flow" } },
    terminals: { [terminal.uniqueId]: { inWg: 0.5 } },
  };
  expect(model("flows", store)).toMatchObject({
    value: 200,
    source: "model",
    note: "Changed in Revit since Pe wrote 150 cfm",
  });
  // An agreeing receipt, and an element Pe never wrote, draw no note.
  expect(model("terminalDrops", store)).not.toHaveProperty("note");
  expect(model("flows", {})).not.toHaveProperty("note");
  // P26: one drift signal. The retired value equals the model, so the kernel's compare is silent; the receipt's drift is the cell's.
  const cells = (store: object) =>
    sheetCells(
      { ...fansCalc, bindings: { flows: fansCalc.bindings.flows } },
      { rows: [], work: fansDocumentSchema.parse({}), read: read(store) },
    );
  expect(cells(store)[0]).toMatchObject({
    value: 200,
    model: 200,
    drift: true,
    note: "Changed in Revit since Pe wrote 150 cfm",
  });
  expect(cells({})[0]).toMatchObject({ value: 200, drift: false });
});

test("slot names use project and firm settings and never stage Work", () => {
  const binding = Object.entries(fansCalc.bindings).find(
    ([key]) => key === "setting.ducts.parameters.fanFlow",
  )?.[1];
  expect(binding).toMatchObject({
    home: {
      at: "setting",
      owner: "ducts",
      path: ["parameters", "fanFlow"],
      tiers: ["project", "firm"],
    },
  });
  expect(fansDocumentSchema.parse({})).not.toHaveProperty("parameters");
});

test("F6 a staged unit role draws its option label with its author, never its object", () => {
  const unit = {
    id: 7,
    kind: "equipment",
    uniqueId: "unit-7",
    family: "MUAS",
    type: "A",
    mark: "MUAS-1",
    connectors: [],
    facts: [],
  };
  const row = elementSubject(unit);
  const edit = { edit: { value: { role: "fan" }, by: "human" } };
  const resolved = {
    value: "passive",
    source: "model",
    units: null,
    version: null,
    status: "valid",
  };
  const view = drawn(
    {
      calcSnapshot: { nodes: [unit], segments: [], slots: {} },
      calcView: { inputs: { units: { 7: { role: resolved } } }, firm: null },
    },
    { roles: { [row]: edit } },
    () => handle(edit),
    "roles",
  );
  expect(view.container.textContent).toContain("Fan");
  expect(view.container.textContent).not.toContain('{"role"');
  expect(view.container.querySelector('[data-unsaved="human"]')).toBeTruthy();
});

/*
 * Slice 2b's no-shared-root disclosure (wave 1 review catch 3, S7-F4 and S7-F5): with no shared root
 * the firm layer is refused, a firm criterion stands on the engine seed and says so, and the fix
 * line is drawn. /ducts on the cell, /fans on its line from the /ducts design.
 */
const refused = { refused: "no-shared-root" } as const;
const paneOf = (slot: typeof fansCalc, read: object) =>
  render(
    <RegistryContext value={makeAtomRegistry()}>
      <SheetPane
        ctx={{
          draw: {
            cells: { doc: {}, at: () => handle({}) },
            page: { read: () => ({}) },
            verb: () => ({ run: async () => null, refusal: null }),
            value: { state: "ready", value: read },
          } as never,
          slot: slot as never,
        }}
      />
    </RegistryContext>,
  );

test("/fans with no shared root: its line from the /ducts design says the engine default and draws the fix line", () => {
  const read = {
    ductSystemsRevision: 3,
    calcSnapshot: { ...snapshot, systems: [] },
    calcView: { inputs: null, firm: refused },
    fans: { slots: [] },
  };
  const from = paneOf({ ...fansCalc, bindings: {} } as never, read).container.querySelector(
    "[data-sheet-from]",
  )!.textContent;
  expect(from).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(from).toContain(NO_SHARED_ROOT);
});
