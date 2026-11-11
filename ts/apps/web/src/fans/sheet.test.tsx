// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema, fansDocumentSchema } from "@pe/agent-contracts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { makeAtomRegistry } from "../shell/owner";
import { SheetPane } from "../route/slots/sheet/pane.tsx";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { designSheet, ENGINE_DEFAULT_NO_SHARED_ROOT, NO_SHARED_ROOT } from "../ducts/design-sheet.ts";
import { fansSheet } from "./sheet.ts";

/*
 * Slice 7 Delete (ruling 2026-11-10: split by owner). Each sheet stages only its own route's Work,
 * and the Fans inputs proofs that used to sit on InputsBody hold on the slot-drawn sheet.
 */
afterEach(cleanup);

test("/fans stages no /ducts Work, and /ducts' sheet stages its criteria", () => {
  const fansKeys = Object.keys(fansDocumentSchema.shape), ductsKeys = Object.keys(ductsDocumentSchema.shape);
  // Every Fans binding addresses a Fans Work key that /ducts does not own.
  for (const binding of Object.keys(fansSheet.bindings)) {
    expect(fansKeys, binding).toContain(binding);
    expect(binding === "writeIntent" || !ductsKeys.includes(binding), binding).toBe(true);
  }
  // /ducts' sheet stages its criteria (a row per cell) and the design friction rate, in /ducts Work.
  expect(Object.keys(designSheet.bindings)).toEqual(["criteria", "designFriction"]);
  for (const binding of Object.keys(designSheet.bindings)) expect(ductsKeys).toContain(binding);
  const rows = sheetCells(designSheet, { rows: [], work: { criteria: { velocitySupplyFpm: { edit: { value: 850, by: "human" } } } }, model: [], read: null });
  expect(rows.find((c) => c.row === "velocitySupplyFpm")).toMatchObject({ value: 850, source: "work", label: "Velocity limit supply" });
  expect(rows.find((c) => c.binding === "designFriction")).toMatchObject({ value: 0.08, source: "default", unit: "in-wg/100 ft" });
});

const handle = (value: object, stage = vi.fn(async () => null)) => ({
  owner: { route: "fans", label: "Work" }, refusal: null, value, freshness: "current" as const,
  transitions: () => [], stage, clear: async () => null,
});
const espOptions = { descriptor: { key: "parameter-identities", mode: "Suggestion", allowsCustomValue: true, dependsOn: [], requiredRuntimeMode: "LiveDocument" },
  result: { kind: "Success", message: "" },
  items: [{ value: "shared:esp|instance", label: "Available ESP · instance", metadata: { name: "Available ESP", kind: "Shared", scope: "instance", storageType: "Double", dataTypeId: "pressure" } }] };
const drawn = (read: object, doc: Record<string, unknown>, at: (path: readonly string[]) => object, only: keyof typeof fansSheet.bindings) => {
  const slot = { ...fansSheet, bindings: { [only]: fansSheet.bindings[only] } };
  const ctx = { cells: { doc, at }, page: { read: () => ({}) }, value: { status: "ready", current: true, value: read } };
  return render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
};
const snapshot = { nodes: [], segments: [], slots: { fanStatic: "Old ESP" } };

test("F5 live parameter metadata reaches the slot picker, which stages the name, not the identity key", async () => {
  const stage = vi.fn(async () => null);
  drawn({ sheetSnapshot: snapshot, espOptions, espOptionsError: null, sheetView: { inputs: null, firm: null }, fans: { slots: [] } }, {},
    (path) => handle({}, path[1] === "fanStatic" ? stage : undefined), "parameters");
  fireEvent.click(screen.getByRole("button", { name: "Old ESP" }));
  expect(await screen.findByText("Shared · Double · pressure")).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /Available ESP/ }));
  await waitFor(() => expect(stage).toHaveBeenCalledWith("Available ESP", { label: "Unit ESP slot" }));
});

test("F5 absent or failed options cannot stage a stale slot name", async () => {
  const stage = vi.fn(async () => null);
  drawn({ sheetSnapshot: snapshot, espOptions: null, espOptionsError: "Disconnected", sheetView: { inputs: null, firm: null }, fans: { slots: [] } }, {},
    (path) => handle({}, path[1] === "fanStatic" ? stage : undefined), "parameters");
  const cell = screen.getByText("Unit ESP slot").parentElement!;
  expect(cell.querySelector("input")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Old ESP" })[0]!);
  const option = await screen.findByRole("option", { name: /Disconnected/ });
  fireEvent.click(option);
  expect(stage).not.toHaveBeenCalled();
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
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: { cells: { doc: {}, at: () => handle({}) }, page: { read: () => ({}) },
    value: { status: "ready", current: true, value: read } } as never, slot: slot as never }} /></RegistryContext>);

test("/ducts with no shared root: a firm criterion is the engine default, and the fix line is drawn", () => {
  const firmCell = { value: 900, source: "firm", units: "fpm" };
  const read = { criteria: { velocityLimitFpm: { supply: firmCell, return: firmCell } }, firm: refused };
  const cell = sheetCells(designSheet, { rows: [], work: {}, model: [], read }).find((c) => c.row === "velocitySupplyFpm");
  expect(cell).toMatchObject({ value: 900, source: "default", ref: ENGINE_DEFAULT_NO_SHARED_ROOT });
  const pane = paneOf(designSheet, read).container;
  expect(pane.querySelector('[data-sheet-address="criteria:velocitySupplyFpm"]')!.textContent).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(pane.querySelector("[data-sheet-from]")!.textContent).toBe(NO_SHARED_ROOT);
});

test("/fans with no shared root: its line from the /ducts design says the engine default and draws the fix line", () => {
  const read = { ductsRevision: 3, sheetSnapshot: { ...snapshot, systems: [] }, sheetView: { inputs: null, firm: refused }, fans: { slots: [] } };
  const from = paneOf({ ...fansSheet, bindings: {} } as never, read).container.querySelector("[data-sheet-from]")!.textContent;
  expect(from).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(from).toContain(NO_SHARED_ROOT);
});
