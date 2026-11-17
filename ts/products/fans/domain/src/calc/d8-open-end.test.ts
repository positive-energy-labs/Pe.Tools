import { expect, it } from "vite-plus/test";
import { connOf, ductOf, nodeOf, round, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { buildCalc } from "./build.ts";
import { flowsOf } from "./flow.ts";
import { grids } from "./tables.fixture.ts";
import { inputsFor } from "./test-inputs.ts";
import { calcBreakdown } from "./calc-breakdown.ts";
import type { Walk } from "./walk.ts";

// The diagnosis reproducer, with complete typed states instead of a cast to Walk.
const openWalk = (): Walk => ({
  states: [
    {
      el: nodeOf(100, "equipment"),
      parent: -1,
      in: undefined,
      via: undefined,
      depth: 0,
      cls: null,
      blockerIds: [],
    },
    { el: nodeOf(17, "fitting"), parent: 0, in: 1, via: 2, depth: 1, cls: null, blockerIds: [] },
  ],
  ends: [
    {
      state: 1,
      out: 11,
      end: { kind: "open-end", elementId: 17, connector: 11 },
      blockerIds: ["open-end:17:11"],
    },
  ],
  blockers: new Map(),
  depth: new Map([
    [100, 0],
    [17, 1],
  ]),
  rejoins: 0,
  autoJoins: [],
  heals: [],
  capped: [],
});
const options = { ordinary: true, terminalCfm: () => null };
const block = () => "no-flow:17";

it("D8: an unresolved open end has unknown flow, never an invented zero", () => {
  const flow = flowsOf(openWalk(), options, block);
  expect(flow.endSource).toEqual([null]);
  expect(flow.end).toEqual([null]);
});

it("D8: one unknown contributor withholds the leg total, including known siblings", () => {
  const walk = openWalk();
  expect(flowsOf(walk, options, block).leg.get("1>11")?.cfm).toBeNull();
  walk.states.push({
    el: nodeOf(18, "terminal"),
    parent: 1,
    in: 1,
    via: 11,
    depth: 2,
    cls: null,
    blockerIds: [],
  });
  walk.ends.push({
    state: 2,
    out: undefined,
    end: { kind: "terminal", elementId: 18 },
    blockerIds: [],
  });
  const flow = flowsOf(walk, { ordinary: true, terminalCfm: () => 150 }, block);
  expect(flow.end).toEqual([null, 150]);
  expect(flow.leg.get("1>11")?.cfm).toBeNull();
  expect(flow.leg.get("2>")?.cfm).toBe(150);
});

it("D8: a sibling-fan's deliberate zero retains its source and leg total", () => {
  const walk = openWalk();
  walk.ends = [{ state: 1, out: 11, end: { kind: "sibling-fan", elementId: 17 }, blockerIds: [] }];
  const flow = flowsOf(walk, options, block);
  expect(flow.end).toEqual([0]);
  expect(flow.endSource).toEqual(["sibling-fan"]);
  expect(flow.leg.get("1>11")?.cfm).toBe(0);
  expect(flow.leg.get("1>11")?.sources).toEqual(new Set(["sibling-fan"]));
});

it("D8: a chain's excluded ends carry an explicit zero", () => {
  const walk = openWalk();
  walk.ends.push({ state: 1, out: 12, end: { kind: "open-end", elementId: 17 }, blockerIds: [] });
  const flow = flowsOf(walk, { ...options, only: { end: 0, cfm: 150, source: "typed" } }, block);
  expect(flow.end).toEqual([150, 0]);
  expect(flow.endSource).toEqual(["typed", "outside chain"]);
  expect(flow.leg.get("1>11")?.cfm).toBe(150);
  expect(flow.leg.get("1>12")?.cfm).toBe(0);
});

it("D8: an open duct end stays unknown through sheet pricing and the worksheet", () => {
  const snapshot = snapshotOf({
    nodes: [nodeOf(100, "equipment", { connectors: [connOf(2, [17, 1], round(9))] })],
    segments: [
      ductOf(17, {
        ...round(9),
        lengthFt: 10,
        polyline: [
          [0, 0, 0],
          [10, 0, 0],
        ],
        connectors: [
          connOf(1, [100, 2], round(9)),
          connOf(11, null, { ...round(9), point: [10, 0, 0] }),
        ],
      }),
    ],
  });
  const sheet = buildCalc({
    snapshot,
    grids,
    inputs: inputsFor(snapshot),
    fan: { unitId: 100, portIndex: 2 },
    roster: [],
  });
  expect(Object.values(sheet.legs).map((l) => l.flowCfm)).toEqual([null]);
  const runs = calcBreakdown(sheet, { maxFpm: { supply: 900, return: 700 } }).supply.runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ cfm: null, complete: false });
});
