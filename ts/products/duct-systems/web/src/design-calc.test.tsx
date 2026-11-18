// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/agent-contracts";
import { sheetCells } from "../../../../apps/web/src/route/slots/sheet/index.ts";
import { SheetPane } from "../../../../apps/web/src/route/slots/sheet/pane.tsx";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { ENGINE_DEFAULT_NO_SHARED_ROOT, NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import { designCalc } from "./design-calc.ts";
afterEach(cleanup);


const handle = (value: object, stage = vi.fn(async () => null)) => ({
  owner: { route: "fans", label: "Work" }, refusal: null, value, freshness: "current" as const,
  transitions: () => [], stage, clear: async () => null,
});

/*
 * Slice 2b's no-shared-root disclosure (wave 1 review catch 3, S7-F4 and S7-F5): with no shared root
 * the firm layer is refused, a firm criterion stands on the engine seed and says so, and the fix
 * line is drawn. /ducts on the cell, /fans on its line from the /ducts design.
 */
const refused = { refused: "no-shared-root" } as const;
const paneOf = (slot: typeof designCalc, read: object) =>
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: { cells: { doc: {}, at: () => handle({}) }, page: { read: () => ({}) }, verb: () => ({ run: async () => null, refusal: null }),
    value: { state: "ready", value: read } } as never, slot: slot as never }} /></RegistryContext>);

test("/ducts with no shared root: a firm criterion is the engine default, and the fix line is drawn", () => {
  const ductsKeys = Object.keys(ductsDocumentSchema.shape);
  const staged = (sheet: typeof designCalc) => Object.keys(sheet.bindings).filter(name => sheet.bindings[name]!.home.at !== "setting");
  // /ducts' sheet stages its criteria (a row per cell) and the design friction rate, in /ducts Work.
  expect(staged(designCalc).map(name => name.split(".")[0]).every(name => name === "criteria")).toBe(true);
  for (const binding of staged(designCalc)) expect(ductsKeys).toContain(binding.split(".")[0]);
  const rows = sheetCells(designCalc, { rows: [], work: { criteria: { velocitySupplyFpm: { edit: { value: 850, by: "human" } } } }, model: [], read: null });
  expect(rows.find((c) => c.binding === "criteria.velocitySupplyFpm")).toMatchObject({ value: 850, source: "work", label: "Velocity limit supply" });
  expect(rows.find((c) => c.binding === "setting.ducts.designFriction")).toMatchObject({ value: 0.08, source: "default", unit: "in-wg/100 ft" });
  const firmCell = { value: 900, source: "firm", units: "fpm" };
  const read = { criteria: { velocityLimitFpm: { supply: firmCell, return: firmCell } }, firm: refused };
  const cell = sheetCells(designCalc, { rows: [], work: {}, model: [], read }).find((c) => c.binding === "criteria.velocitySupplyFpm");
  expect(cell).toMatchObject({ value: 900, source: "default", ref: ENGINE_DEFAULT_NO_SHARED_ROOT });
  const pane = paneOf(designCalc, read).container;
  expect(pane.querySelector('[data-sheet-address="criteria.velocitySupplyFpm"]')!.textContent).toContain(ENGINE_DEFAULT_NO_SHARED_ROOT);
  expect(pane.querySelector("[data-sheet-from]")!.textContent).toBe(NO_SHARED_ROOT);
});
