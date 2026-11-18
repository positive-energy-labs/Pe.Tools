// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { ductsRosterResponseSchema, openFanCalcSchema } from "@pe/agent-contracts";
import fixture from "@pe/ducts-web/fixtures/fan-sheet.json";
import { espWarnings } from "../picture.tsx";
import { Ledger, Roster } from "./view.tsx";

afterEach(cleanup);

test.each([true, false])("roster ESP names its source when complete=%s", (complete) => {
  const fan = {
    ...ductsRosterResponseSchema.parse(fixture.roster).rows[0]!,
    complete,
    requiredEspInWg: complete ? 0.75 : null,
  };
  const view = render(
    <Roster props={{ roster: [fan], nameOf: String, open() {}, busy: false, loading: false }} />,
  );
  expect(view.container.textContent).toContain(complete ? "computed" : "partial");
  if (complete) expect(view.container.textContent).toContain("0.7500");
});

test("Ledger allowances carry the resolved criterion's source and reference", () => {
  const sheet = openFanCalcSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: null,
    legs: null,
    worstLegs: [],
    calcBreakdown: null,
  });
  const inputs = sheet.inputs!.inputs;
  inputs.criteria.allowanceInWg.supply = {
    ...inputs.criteria.allowanceInWg.supply,
    value: 0.125,
    source: "firm",
    ref: "Settings/ducts.json",
  };
  sheet.overview.totals!.supply.allowanceInWg = 0.125;
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
          throw Error("No blockers");
        },
        close() {},
        closeMany() {},
        focusedBlocker: null,
        focusBlocker() {},
      }}
    />,
  );
  for (const side of ["supply", "return"]) {
    const cell = view.container.querySelector(
      `[data-sheet-esp] [data-side="${side}"] > span:last-child`,
    )!;
    const resolved = inputs.criteria.allowanceInWg[side as "supply" | "return"];
    expect(cell.textContent).toContain(resolved.value!.toFixed(4));
    expect(cell.textContent).toContain(resolved.source);
    expect(cell.querySelector("[data-input-source]")?.getAttribute("aria-description")).toBe(
      resolved.ref,
    );
  }
});

test("picture's rated-below-required warning preserves the source of each number", () => {
  const rated = {
    value: 0.5,
    source: "model" as const,
    ref: "PE_ESP",
    status: "valid" as const,
    author: null,
    version: null,
    units: "in-wg",
  };
  const warnings = espWarnings({
    rated,
    required: {
      kind: "complete",
      basis: "fixture",
      requiredEspInWg: 0.75,
      coverage: [],
      blockingIds: [],
    },
  });
  const view = render(
    <>
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </>,
  );
  expect(view.container.textContent).toContain("0.50 in-wg (model PE_ESP)");
  expect(view.container.textContent).toContain("0.75 in-wg (computed)");
});
