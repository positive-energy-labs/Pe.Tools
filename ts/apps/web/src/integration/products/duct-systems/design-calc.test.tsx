// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { DUCTS_CRITERIA_CELLS } from "@pe/ducts-contract/duct-inputs";
import { sheetCells } from "../../../route/slots/sheet/index.ts";
import { SheetPane } from "../../../route/slots/sheet/pane.tsx";
import { makeAtomRegistry } from "../../../shell/owner.ts";
import { NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import { ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/ducts-contract/product";
import { designCalc } from "../../../../../../products/duct-systems/web/src/design-calc.ts";
afterEach(cleanup);

const handle = (value: object, stage = vi.fn(async () => null)) => ({
  owner: { route: "fans", label: "Work" },
  refusal: null,
  value,
  freshness: "current" as const,
  transitions: () => [],
  stage,
  clear: async () => null,
});

/*
 * Slice 2b's no-shared-root disclosure (wave 1 review catch 3, S7-F4 and S7-F5): with no shared root
 * the firm layer is refused, a firm criterion stands on the engine seed and says so, and the fix
 * line is drawn. /ducts on the cell, /fans on its line from the /ducts design.
 */
const refused = { refused: "no-shared-root" } as const;
const paneOf = (slot: typeof designCalc, read: object) =>
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

test("/ducts with no shared root: a firm criterion is the engine default, and the fix line is drawn", () => {
  const ductsKeys = Object.keys(ductsDocumentSchema.shape);
  const staged = (sheet: typeof designCalc) =>
    Object.keys(sheet.bindings).filter((name) => sheet.bindings[name]!.home.at !== "setting");
  expect(staged(designCalc).sort()).toEqual(Object.keys(DUCTS_CRITERIA_CELLS).sort());
  for (const binding of staged(designCalc)) expect(ductsKeys).toContain(binding);
  const rows = sheetCells(designCalc, {
    rows: [],
    work: { velocitySupplyFpm: { edit: { value: 850, by: "human" } } },
    read: null,
  });
  expect(rows.find((c) => c.binding === "velocitySupplyFpm")).toMatchObject({
    value: 850,
    source: "work",
    label: "Velocity limit supply",
    home: { at: "local" },
  });
  expect(rows.find((c) => c.binding === "setting.ducts.designFriction")).toMatchObject({
    value: 0.08,
    source: "default",
    unit: "in-wg/100 ft",
  });
  const firmCell = { value: 900, source: "firm", units: "fpm" };
  const read = {
    criteria: { velocityLimitFpm: { supply: firmCell, return: firmCell } },
    firm: refused,
  };
  const cell = sheetCells(designCalc, { rows: [], work: {}, read }).find(
    (c) => c.binding === "velocitySupplyFpm",
  );
  expect(cell).toMatchObject({ value: 900, source: "default", ref: ENGINE_DEFAULT_NO_SHARED_ROOT });
  const pane = paneOf(designCalc, read).container;
  expect(pane.querySelector('[data-sheet-address="velocitySupplyFpm"]')!.textContent).toContain(
    ENGINE_DEFAULT_NO_SHARED_ROOT,
  );
  expect(pane.querySelector("[data-sheet-from]")!.textContent).toBe(NO_SHARED_ROOT);
});
