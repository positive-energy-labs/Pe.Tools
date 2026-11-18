import { expect, it } from "vite-plus/test";
import { factOf, nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { fansDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { encounterRulings, resolveInputs, resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { cell, stamped, TEST_FIRM, TEST_SLOTS } from "@pe/ducts-domain/test-inputs";
import type { CalcSnapshot } from "./build.ts";
import { flowsOf } from "./flow.ts";
import type { Walk } from "./walk.ts";
import { calcBreakdown } from "./calc-breakdown.ts";
import type { Calc } from "./types.ts";
const snapshot = {
  slots: { ...TEST_SLOTS, terminalFlow: "terminalFlow" },
  nodes: [{ uniqueId: `6d52156a-3876-4d76-b641-341454252f26-${(1).toString(16).padStart(8, "0")}`,  id: 1, kind: "terminal", facts: [{ key: "flow", value: 200 }], connectors: [] }],
  segments: [],
} as unknown as CalcSnapshot;
const bare = { ...snapshot, nodes: [{ ...snapshot.nodes[0]!, facts: [] }] } as unknown as CalcSnapshot;
it("P-048: a stored invalid marker crosses stagedDucts and blocks model fallback", () => {
  const work = stagedDucts(null, fansDocumentSchema.parse({
    flows: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": { invalid: "unstamped stored cell" } },
  }));
  expect(resolveInputs({ snapshot, work: { flows: work.flows }, firm: TEST_FIRM })
    .terminals["1"]?.cfm).toMatchObject({ status: "invalid", value: null, source: "Work" });
});
it("duct readings expose run, Work, model and firm provenance with units", () => {
  const layers = {
    snapshot,
    firm: TEST_FIRM,
    run: { flows: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": cell(0) } },
    work: { flows: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": cell(100) } },
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
  ).toMatchObject({ value: 200, source: "model", ref: "model:1/terminalFlow" });
  expect(resolveInputs({ snapshot: bare, firm: TEST_FIRM }).terminals["1"]!.cfm.status).toBe("missing");
  expect(resolveInputs({ snapshot: bare, firm: TEST_FIRM }).terminals["1"]!.drop).toMatchObject({
    source: "firm",
    version: "test",
    units: "in-wg",
  });
  expect(
    resolveCriteria(stamped({ allowanceInWg: { return: 0.2 } }), TEST_FIRM)
      .allowanceInWg,
  ).toMatchObject({ supply: { source: "firm" }, return: { source: "Work", value: 0.2 } });
});
it("a value retired into the model store reads live from its parameter; the receipt is never a rung (ADR 0053)", () => {
  // Terminal 1 states 0.5 in-wg on its TerminalDrop slot parameter; the firm default disagrees too.
  const native = {
    nodes: [{ uniqueId: `6d52156a-3876-4d76-b641-341454252f26-${(1).toString(16).padStart(8, "0")}`,  id: 1, kind: "terminal", facts: [], connectors: [], terminalDrop: { catalogDropInWg: 0.5 } }],
    segments: [],
    slots: { ...TEST_SLOTS, terminalDrop: "PE_Drop" },
  } as unknown as CalcSnapshot;
  const drop = (work: object | undefined, store: object | undefined) =>
    resolveInputs({ snapshot: { ...native, store } as CalcSnapshot, firm: TEST_FIRM, work }).terminals["1"]!.drop;
  expect(drop({ terminalDrops: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": cell(0.2) } }, undefined)).toMatchObject({ value: 0.2, source: "Work" });
  // The receipt retires the staged cell: Work is cleared, and a hand edit in Revit since (0.5) is the value.
  const retired = drop(undefined, { terminals: { "1": { inWg: 0.2 } } });
  expect(retired).toMatchObject({ value: 0.5, source: "model", ref: "model:1/PE_Drop", author: null, units: "in-wg" });
  expect(retired.version).toBeNull();
  // A pending Work edit wins over the older stored value.
  expect(drop({ terminalDrops: { "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000001": cell(0.3) } }, { terminals: { "1": { inWg: 0.2 } } })).toMatchObject({
    value: 0.3,
    source: "Work",
  });
  // A receipt never prices, whatever it holds: the live parameter answers.
  expect(drop(undefined, { terminals: { "1": { inWg: -1 } } })).toMatchObject({ value: 0.5, source: "model", status: "valid" });
  expect(drop(undefined, undefined)).toMatchObject({ value: 0.5, source: "model" });
  // D3: the written parameter no longer reads, so the value is missing, never the receipt or the firm default.
  native.nodes[0]!.terminalDrop = {} as never;
  expect(drop(undefined, { terminals: { "1": { inWg: 0.2 } } })).toMatchObject({ value: null, status: "missing" });
  expect(drop(undefined, undefined)).toMatchObject({ source: "firm" });
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
    claim: { kind: "complete" },
  } as unknown as Calc;
  const w = calcBreakdown(sheet, { maxFpm: { supply: 900, return: 700 } }).supply;
  expect(w.runs[0]).toMatchObject({ complete: false, critical: false, residualInWg: null });
  expect(w.sections[0]).toMatchObject({ complete: false, unpricedLegs: 1 });
});

it("P-030: rated ESP is stated or read from its own named slot, never the parameter Pe writes", () => {
  const key = "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000002";
  const fan = snapshotOf({
    nodes: [
      nodeOf(2, "equipment", {
        uniqueId: key.slice(9),
        family: "AHU",
        type: "a",
        facts: [factOf("externalStatic", 0.5)],
        connectors: [],
      }),
    ],
    segments: [],
  });
  const layers = { snapshot: fan, firm: TEST_FIRM, work: {} };
  // P-030: the `externalStatic` fact is what a Pe write of required ESP leaves in `requiredEsp`. Rated stays
  // unknown over it, and a stated rated value is the stated one, never the written 0.5.
  expect(resolveInputs(layers).units["2"]!.esp).toMatchObject({ status: "missing", value: null, source: "none" });
  fan.nodes[0]!.facts.push(factOf("ratedStatic", 0.65));
  expect(resolveInputs(layers).units["2"]!.esp.status).toBe("missing");
  fan.slots = { ...fan.slots, ratedEsp: "Rated ESP" };
  expect(resolveInputs(layers).units["2"]!.esp).toMatchObject({ value: 0.65, source: "model", author: null });
  const rated = (ratedEsp: unknown) =>
    resolveInputs({ ...layers, work: { ...layers.work, ratedEsp: { [key]: ratedEsp as never } } }).units["2"]!.esp;
  expect(rated(cell(0.75, "human", "work:fans/ratedEsp/2"))).toMatchObject({
    status: "valid",
    value: 0.75,
    source: "Work",
    author: "human",
  });
  // P-032: a Work cell with no `by` resolves invalid through the engine's inputs, never as a person's.
  expect(rated({ value: 0.75, ref: "work:test" })).toMatchObject({ status: "invalid", value: null, author: null });
  // P-029: a ruling no known caller stamped is invalid and rules nothing.
  expect(
    encounterRulings({
      work: { assumptions: { "encounter:20:2": { value: { kind: "verdict", verdict: "connect" }, ref: "work:test" } as never } },
    }),
  ).toEqual([]);
  expect(
    encounterRulings({ work: { assumptions: { "encounter:20:2": cell({ kind: "verdict", verdict: "connect" }) } } }),
  ).toEqual([{ at: { elementId: 20, connector: 2 }, verdict: "accepted", by: "human", ref: "work:test" }]);
});
