// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema, fansDocumentSchema } from "@pe/agent-contracts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { makeAtomRegistry } from "../shell/owner";
import { SheetPane } from "../route/slots/sheet/pane.tsx";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { designSheet } from "../ducts/design-sheet.ts";
import { ENGINE_DEFAULT_NO_SHARED_ROOT, NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import { fansSheet } from "./sheet.ts";

/*
 * Slice 7 Delete (ruling 2026-11-10: split by owner). Each sheet stages only its own route's Work,
 * and the Fans inputs proofs that used to sit on InputsBody hold on the slot-drawn sheet.
 */
afterEach(cleanup);

test("/fans stages no /ducts Work, and /ducts' sheet stages its criteria", () => {
  const fansKeys = Object.keys(fansDocumentSchema.shape), ductsKeys = Object.keys(ductsDocumentSchema.shape);
  // Every Fans binding addresses a Fans Work key that /ducts does not own.
  // A `setting` binding stages no Work at all: it saves at a home tier (slice 6b).
  const staged = (sheet: { bindings: Readonly<Record<string, { home: { at: string } }>> }) => Object.keys(sheet.bindings).filter((name) => sheet.bindings[name]!.home.at !== "setting");
  expect(Object.keys(fansSheet.bindings).length).toBeGreaterThan(staged(fansSheet).length);
  for (const binding of staged(fansSheet)) {
    expect(fansKeys, binding).toContain(binding);
    expect(binding === "writeIntent" || !ductsKeys.includes(binding), binding).toBe(true);
  }
  // /ducts' sheet stages its criteria (a row per cell) and the design friction rate, in /ducts Work.
  expect(staged(designSheet).map(name => name.split(".")[0]).every(name => name === "criteria")).toBe(true);
  for (const binding of staged(designSheet)) expect(ductsKeys).toContain(binding.split(".")[0]);
  const rows = sheetCells(designSheet, { rows: [], work: { criteria: { velocitySupplyFpm: { edit: { value: 850, by: "human" } } } }, model: [], read: null });
  expect(rows.find((c) => c.binding === "criteria.velocitySupplyFpm")).toMatchObject({ value: 850, source: "work", label: "Velocity limit supply" });
  expect(rows.find((c) => c.binding === "setting.ducts.designFriction")).toMatchObject({ value: 0.08, source: "default", unit: "in-wg/100 ft" });
});

const handle = (value: object, stage = vi.fn(async () => null)) => ({
  owner: { route: "fans", label: "Work" }, refusal: null, value, freshness: "current" as const,
  transitions: () => [], stage, clear: async () => null,
});
const drawn = (read: object, doc: Record<string, unknown>, at: (path: readonly string[]) => object, only: keyof typeof fansSheet.bindings, state: "ready" | "refreshing" = "ready") => {
  const slot = { ...fansSheet, bindings: { [only]: fansSheet.bindings[only] } };
  const ctx = { cells: { doc, at }, page: { read: () => ({}) }, value: { state, value: read }, verb: () => ({ run: async () => null, refusal: null }) };
  return render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
};
const snapshot = { nodes: [], segments: [], slots: { fanStatic: "Old ESP" } };

test("D25: a retained resolved Work airflow keeps Work provenance after its live edit is undone", () => {
  const unit = { id: 7, kind: "equipment", uniqueId: "unit-7", family: "MUAS", type: "A", mark: "MA-1", connectors: [], facts: [] };
  const row = elementSubject(unit);
  const read = { sheetSnapshot: { ...snapshot, nodes: [unit] }, sheetView: { inputs: { units: { "7": { cfm: { value: 1234, source: "Work" } } } } } };
  const cells = sheetCells({ ...fansSheet, bindings: { equipmentFlows: fansSheet.bindings.equipmentFlows } }, { rows: [], work: fansDocumentSchema.parse({}), model: [], read });
  expect(cells.find(cell => cell.row === row)).toMatchObject({ value: 1234, source: "work", pending: null });
  const view = drawn(read, {}, () => handle({}), "equipmentFlows", "refreshing");
  expect(view.container.querySelector('[data-input-source="work"]')?.textContent).toBe("work");
  expect(view.container.querySelector('[data-sheet-cell]')?.textContent).not.toContain("model");
  expect(view.container.textContent).toContain("1234");
});

test("slot names use project and firm settings and never stage Work", () => {
  const binding = Object.entries(fansSheet.bindings).find(([key]) => key === "setting.ducts.parameters.fanStatic")?.[1];
  expect(binding).toMatchObject({ home: { at: "setting", owner: "ducts", path: ["parameters", "fanStatic"], tiers: ["project", "firm"] } });
  expect(fansDocumentSchema.parse({})).not.toHaveProperty("parameters");
});

test("F6 a staged unit role draws its option label with its author, never its object", () => {
  const unit = { id: 7, kind: "equipment", uniqueId: "unit-7", family: "MUAS", type: "A", mark: "MUAS-1", connectors: [], facts: [] };
  const row = elementSubject(unit);
  const edit = { edit: { value: { role: "fan" }, by: "human" } };
  const resolved = { value: "passive", source: "model", units: null, version: null, status: "valid" };
  const view = drawn({ sheetSnapshot: { nodes: [unit], segments: [], slots: {} }, sheetView: { inputs: { units: { 7: { role: resolved } } }, firm: null } },
    { roles: { [row]: edit } }, () => handle(edit), "roles");
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
const paneOf = (slot: typeof designSheet | typeof fansSheet, read: object) =>
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: { cells: { doc: {}, at: () => handle({}) }, page: { read: () => ({}) }, verb: () => ({ run: async () => null, refusal: null }),
    value: { state: "ready", value: read } } as never, slot: slot as never }} /></RegistryContext>);

test("/ducts with no shared root: a firm criterion is the engine default, and the fix line is drawn", () => {
  const firmCell = { value: 900, source: "firm", units: "fpm" };
  const read = { criteria: { velocityLimitFpm: { supply: firmCell, return: firmCell } }, firm: refused };
  const cell = sheetCells(designSheet, { rows: [], work: {}, model: [], read }).find((c) => c.binding === "criteria.velocitySupplyFpm");
  expect(cell).toMatchObject({ value: 900, source: "default", ref: ENGINE_DEFAULT_NO_SHARED_ROOT });
  const pane = paneOf(designSheet, read).container;
  expect(pane.querySelector('[data-sheet-address="criteria.velocitySupplyFpm"]')!.textContent).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(pane.querySelector("[data-sheet-from]")!.textContent).toBe(NO_SHARED_ROOT);
});

test("/fans with no shared root: its line from the /ducts design says the engine default and draws the fix line", () => {
  const read = { ductsRevision: 3, sheetSnapshot: { ...snapshot, systems: [] }, sheetView: { inputs: null, firm: refused }, fans: { slots: [] } };
  const from = paneOf({ ...fansSheet, bindings: {} } as never, read).container.querySelector("[data-sheet-from]")!.textContent;
  expect(from).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(from).toContain(NO_SHARED_ROOT);
});
