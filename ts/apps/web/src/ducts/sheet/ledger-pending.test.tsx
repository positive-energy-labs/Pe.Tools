// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { LedgerProps } from "./types";
import { Ledger } from "./view";
import { openFanSheetSchema as openSheetSchema } from "@pe/agent-contracts";
import fixture from "./sheet.fixture.json";

afterEach(cleanup);

test("a Work ESP is labelled by its resolved source, never as a Revit write", () => {
  const sheet = openSheetSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: null,
    legs: null,
    worstLegs: [],
    worksheet: null,
  });
  if (!sheet.overview.fan) throw Error("The MUAS fixture must contain its fan");
  const inputs = sheet.inputs!.inputs;
  inputs.units[String(sheet.overview.fan.unitId)] = {
    kind: { value: "muas", source: "default", units: null, version: null, status: "valid" },
    role: { value: "fan", source: "default", units: null, version: null, status: "valid" },
    cfm: { value: null, source: "none", units: "cfm", version: null, status: "missing" },
    esp: { value: 2.658079, source: "Work", units: "in-wg", version: 4, status: "valid" },
  };
  const view = render(
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
    />,
  );
  expect(view.getByText("required (Work)")).toBeTruthy();
  expect(view.getByText("2.6581")).toBeTruthy();
  expect(view.queryByText("required (written)")).toBeNull();
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
test("the Ledger summary says N of M branches known and names only a complete branch's worst", () => {
  const sheet = openSheetSchema.parse({
    overview: fixture.overview, inputs: fixture.inputs, elements: null, legs: null, worstLegs: [], worksheet: null,
  });
  const run = (id: string, legId: string, complete: boolean, knownInWg: number) => ({
    id, side: "supply", end: { kind: "terminal", elementId: Number(legId.slice(1)), connector: 1 },
    legIds: [legId], sectionIds: [], cfm: complete ? 200 : null, telFt: complete ? 40 : 0,
    knownInWg, complete, residualInWg: null, critical: false, maxFpm: null, overLegIds: [],
  });
  const leg = (id: string, flowCfm: number | null, lossInWg: number | null) => ({
    id, elementId: Number(id.slice(1)), kind: "duct", flowCfm, flowSource: null, velocityFpm: null,
    lossInWg, lossSource: { kind: "fitting" }, equivalentFt: lossInWg == null ? null : 40,
  });
  // The domain's worst is over complete branches only (worksheet.ts): 0.05 here, none on return.
  (sheet as { worksheet: unknown }).worksheet = {
    target: { session: "s", openId: "o" }, basis: "b", kind: "worksheet",
    limits: { supplyFpm: 900, returnFpm: 700, source: "firm:seed" },
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
  expect(side("supply").slice(0, 3)).toEqual(["supply", "1 of 2 branches known", "0.0500"]);
  expect(side("return").slice(0, 3)).toEqual(["return", "0 of 1 branches known", "—"]);
});
