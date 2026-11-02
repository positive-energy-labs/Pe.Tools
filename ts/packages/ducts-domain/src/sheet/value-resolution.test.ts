import { expect, it } from "vite-plus/test";
import { resolveInputs, resolveCriteria } from "./inputs.ts";
import { TEST_FIRM } from "./test-inputs.ts";
import type { SheetSnapshot } from "./build.ts";
import { flowsOf } from "./flow.ts";
import type { Walk } from "./walk.ts";
import { worksheet } from "./worksheet.ts";
import type { Sheet } from "./types.ts";
const snapshot = {
  nodes: [{ id: 1, kind: "terminal", facts: [], connectors: [] }],
  segments: [],
} as unknown as SheetSnapshot;
it("duct readings expose run, Work, model and firm provenance with units", () => {
  const layers = {
    snapshot,
    firm: TEST_FIRM,
    run: { flows: { "1": { cfm: 0 } } },
    work: { flows: { "1": { cfm: 100 } } },
    store: { terminalFlows: { "1": { cfm: 200 } } },
    versions: { Work: 7 },
  };
  expect(resolveInputs(layers).terminals["1"]!.cfm).toMatchObject({
    value: 0,
    source: "run",
    units: "cfm",
  });
  expect(resolveInputs({ ...layers, run: undefined }).terminals["1"]!.cfm).toMatchObject({
    value: 100,
    source: "Work",
    version: 7,
  });
  expect(
    resolveInputs({ ...layers, run: undefined, work: undefined }).terminals["1"]!.cfm,
  ).toMatchObject({ value: 200, source: "model" });
  expect(resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!.cfm.status).toBe("missing");
  expect(resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!.drop).toMatchObject({
    source: "firm",
    version: "test",
    units: "in-wg",
  });
  expect(
    resolveCriteria({ criteria: { allowanceInWg: { return: 0.2 } } }, null, TEST_FIRM)
      .allowanceInWg,
  ).toMatchObject({ supply: { source: "firm" }, return: { source: "Work", value: 0.2 } });
});
it("unknown inflow creates a missing leg and cannot certify worksheet totals", () => {
  const walk = {
    states: [
      { el: { id: 1 }, parent: -1 },
      { el: { id: 2 }, parent: 0, via: 0 },
    ],
    ends: [{ state: 1, out: 0, end: { kind: "joins-other-fan", elementId: 2 }, blockerIds: [] }],
  } as unknown as Walk;
  const flow = flowsOf(walk, { ordinary: true, terminalCfm: () => null }, (b) => `${b.kind}:2`);
  expect(flow.end).toEqual([null]);
  expect(walk.ends[0]!.blockerIds).toContain("no-flow:2");
  expect([...flow.leg.values()].every((l) => l.cfm == null)).toBe(true);
  const sheet = {
    legs: {
      x: {
        id: "x",
        elementId: 2,
        flowCfm: null,
        lossInWg: null,
        equivalentFt: null,
        velocityFpm: null,
      },
    },
    paths: [
      {
        side: "supply",
        end: walk.ends[0]!.end,
        legIds: ["x"],
        knownInWg: 0,
        complete: true,
        blockerIds: [],
      },
    ],
  } as unknown as Sheet;
  const w = worksheet(sheet, { maxFpm: { supply: 900, return: 700 } }).supply;
  expect(w.runs[0]).toMatchObject({ complete: false, critical: false, residualInWg: null });
  expect(w.sections[0]).toMatchObject({ complete: false, unpricedLegs: 1 });
});
