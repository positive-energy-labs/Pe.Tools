// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { LedgerProps } from "./types.ts";
import { Ledger } from "./view.tsx";
import { openFanCalcSchema as openSheetSchema } from "@pe/agent-contracts";
import fixture from "@pe/ducts-web/fixtures/fan-sheet.json";
import { FANS_LEDGER_ESP } from "../../../../../tests/e2e/cdp.ts";

afterEach(cleanup);

test("a stated rated ESP is labelled rated with its resolved source, never as required or a Revit write", () => {
  const sheet = openSheetSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: null,
    legs: null,
    worstLegs: [],
    calcBreakdown: null,
  });
  if (!sheet.overview.fan) throw Error("The MUAS fixture must contain its fan");
  const inputs = sheet.inputs!.inputs;
  inputs.units[String(sheet.overview.fan.unitId)] = {
    kind: { value: "muas", source: "default", units: null, version: null, status: "valid", author: null, ref: "test" },
    role: { value: "fan", source: "default", units: null, version: null, status: "valid", author: null, ref: "test" },
    cfm: { value: null, source: "none", units: "cfm", version: null, status: "missing", author: null, ref: null },
    esp: { value: 2.658079, source: "Work", units: "in-wg", version: 4, status: "valid", author: null, ref: "test" },
  };
  const draw = () => (
    <div data-pane-id="calc-ledger">
      <Ledger
        props={{
          sheet,
          inputs,
          busy: false,
          loading: false,
          error: null,
          blockers: [],
          taken: [],
          changeInputs() {},
          closerOf() {
            throw Error("No closer in this fixture");
          },
          close() {},
          closeMany() {},
          focusedBlocker: null,
          focusBlocker() {},
        }}
      />
    </div>
  );
  const view = render(draw());
  expect(view.getByText("rated (Work)")).toBeTruthy();
  expect(view.getByText("2.6581")).toBeTruthy();
  expect(view.queryByText("required (written)")).toBeNull();
  expect(view.container.querySelector(FANS_LEDGER_ESP)?.textContent).toBe("2.6581");
  inputs.units[String(sheet.overview.fan.unitId)]!.esp = {
    value: 1.25,
    source: "model",
    units: "in-wg",
    version: 5,
    status: "valid", author: null, ref: "test",
  };
  view.rerender(draw());
  expect(view.container.querySelector(FANS_LEDGER_ESP)?.textContent).toBe("1.2500");
});
test("a recomputing sheet does not claim that no fan is open", () => {
  const props: LedgerProps = {
    sheet: null,
    busy: true,
    loading: false,
    error: null,
    blockers: [],
    taken: [],
    inputs: null,
    changeInputs() {},
    closerOf() {
      throw Error("No blocker in this fixture");
    },
    close() {},
    closeMany() {},
    focusedBlocker: null,
    focusBlocker() {},
  };
  const view = render(<Ledger props={props} />);
  expect(view.getByRole("status").textContent).toContain("computing");
  expect(view.queryByText("No fan open.")).toBeNull();
});

/*
 * F1 (2026-11-10): the Ledger summary counts a side's known branches and names a worst only over
 * complete ones; a side with an incomplete branch never prints a total built from it.
 */
test.each([false, true])("the Ledger summary qualifies the worst subtotal when side complete is %s", (complete) => {
  const sheet = openSheetSchema.parse({
    overview: fixture.overview, inputs: fixture.inputs, elements: null, legs: null, worstLegs: [], calcBreakdown: null,
  });
  const run = (id: string, legId: string, complete: boolean, knownInWg: number) => ({
    id, side: "supply", end: { kind: "terminal", elementId: Number(legId.slice(1)), connector: 1 },
    legIds: [legId], sectionIds: [], cfm: complete ? 200 : null, telFt: complete ? 40 : 0,
    knownInWg, complete, residualInWg: null, critical: false, maxFpm: null, overLegIds: [],
  });
  sheet.overview.totals!.supply.worstPath = complete ? 0.05 : null;
  const leg = (id: string, flowCfm: number | null, lossInWg: number | null) => ({
    id, elementId: Number(id.slice(1)), kind: "duct", flowCfm, flowSource: null, velocityFpm: null,
    lossInWg, lossSource: { kind: "fitting" }, equivalentFt: lossInWg == null ? null : 40,
  });
  // The domain's worst is over complete branches only (worksheet.ts): 0.05 here, none on return.
  (sheet as { calcBreakdown: unknown }).calcBreakdown = {
    target: { session: "s", openId: "o" }, basis: "b", kind: "worksheet",
    limits: { supplyFpm: 900, returnFpm: 700, supplySource: "firm:seed", returnSource: "firm:seed" },
    supply: { runs: [run("r1", "l1", true, 0.05), run("r2", "l2", false, 0)], sections: [], worstKnownInWg: 0.05, elementSections: {} },
    return: { runs: [run("r3", "l3", false, 0)], sections: [], worstKnownInWg: null, elementSections: {} },
    legs: { l1: leg("l1", 200, 0.05), l2: leg("l2", null, null), l3: leg("l3", null, null) },
  };
  const view = render(
    <Ledger
      props={{
        sheet, inputs: sheet.inputs!.inputs, busy: false, loading: false, error: null, blockers: [], taken: [],
        changeInputs() {}, closerOf() { throw Error("No closer in this fixture"); }, close() {}, closeMany() {},
        focusedBlocker: null, focusBlocker() {},
      }}
    />,
  );
  const side = (name: string) =>
    [...view.container.querySelectorAll(`[data-sheet-esp] [data-side='${name}'] > span`)].map((c) => c.textContent);
  // side, count, worst, allowance (the resolved criterion, not a row total).
  expect(side("supply").slice(0, 3)).toEqual(["supply", "1 of 2 branches known", complete ? "0.0500 computed" : "0.0500 partial"]);
  const worst = view.container.querySelector('[data-sheet-esp] [data-side="supply"] > span:nth-child(3)')!;
  expect(worst.querySelector('[data-tone="caution"]')?.textContent ?? null).toBe(complete ? null : " partial");
  expect(side("return").slice(0, 3)).toEqual(["return", "0 of 1 branches known", "—"]);
});
