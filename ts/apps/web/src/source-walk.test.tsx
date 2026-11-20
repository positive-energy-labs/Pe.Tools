// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsRosterResponseSchema } from "@pe/fans-contract/calc-read";
import { openFanCalcSchema } from "@pe/fans-contract/fans-read";
import fixture from "@pe/ducts-web/fixtures/fan-sheet.json";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { SheetPane } from "./route/slots/sheet/pane.tsx";
import { Ledger, Roster } from "@pe/fans-web/calc/view";
import type { LedgerProps } from "@pe/fans-web/calc/types";

vi.mock("@pe/web-kernel/route/activity", () => ({ useRouteSearchSlice: () => ({}) }));
vi.mock("./host/resource-state.ts", () => ({
  useFieldOptionsReading: () => ({ state: "pending" }),
  previousOf: () => null,
}));
afterEach(cleanup);

const sourceWord =
  /\b(computed|partial|model|work|run|user|project|firm|default|balance|derived)\b/i;
const numeric = /(?:^|\s)-?\d+(?:\.\d+)?(?:\s|$)/;

// Walk value-bearing leaves, not identifiers, port indices, or UI counts. Check each
// value's own cell/row so another value's source cannot lend it false provenance.
function missingWords(root: HTMLElement): string[] {
  const missing: string[] = [];
  for (const cell of root.querySelectorAll("[data-sheet-cell]")) {
    const values = [...cell.querySelectorAll("input")].map((input) => input.value);
    if (!values.some((value) => numeric.test(value))) continue;
    const source =
      cell.getAttribute("data-source") ??
      cell.querySelector("[data-input-source]")?.textContent ??
      "";
    if (!sourceWord.test(source)) missing.push(cell.outerHTML);
    expect(cell.textContent).toMatch(sourceWord);
  }
  for (const leaf of root.querySelectorAll(".face-mono")) {
    if (
      leaf.closest("[data-sheet-cell], [data-list-filter-count]") ||
      leaf.querySelector(".face-mono")
    )
      continue;
    if (!numeric.test(leaf.textContent ?? "")) continue;
    const label = leaf.previousElementSibling?.textContent ?? "";
    const context = `${leaf.textContent} ${label.startsWith("rated") ? label : ""}`;
    if (!sourceWord.test(context)) missing.push(leaf.outerHTML);
  }
  return missing;
}

test("every fixture roster, Ledger and duct-systems sheet value has its own source word", () => {
  const sheet = openFanCalcSchema.parse({ ...fixture, worstLegs: [], calcBreakdown: null });
  const inputs = sheet.inputs!.inputs;
  sheet.overview.totals!.requiredEspInWg = 0.75;
  sheet.overview.totals!.supply.worstPath = 0.5;
  sheet.overview.totals!.return.worstPath = 0.25;
  const ledger: LedgerProps = {
    sheet,
    inputs,
    busy: false,
    loading: false,
    error: null,
    blockers: [],
    taken: [],
    changeInputs() {},
    closerOf() {
      throw Error("No blockers");
    },
    close() {},
    closeMany() {},
    focusedBlocker: null,
    focusBlocker() {},
  };
  const ctx = {
    value: { value: { criteria: inputs.criteria, firm: sheet.inputs!.firm } },
    cells: {
      doc: {},
      at: () => ({
        owner: { route: "duct-systems", label: "Work" },
        value: {},
        transitions: () => [],
        refusal: null,
      }),
    },
  };
  const view = render(
    <>
      <Roster
        props={{
          roster: ductsRosterResponseSchema.parse(fixture.roster).rows,
          nameOf: String,
          open() {},
          busy: false,
          loading: false,
        }}
      />
      <Ledger props={ledger} />
      <Ledger props={{ ...ledger, inputs: null }} />
      <SheetPane ctx={{ draw: ctx as never, slot: designCalc }} />
    </>,
  );
  expect(view.container.querySelectorAll("[data-sheet-cell]").length).toBeGreaterThan(0);
  expect(missingWords(view.container)).toEqual([]);
});
