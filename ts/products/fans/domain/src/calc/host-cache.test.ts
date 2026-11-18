import { expect, it, vi } from "vite-plus/test";
import { connOf, nodeOf, ductOf, snapshotOf, round } from "@pe/ducts-domain/test-snapshot";
import { inputsFor, TEST_WALK } from "@pe/ducts-domain/test-inputs";
import type { FanPort } from "@pe/ducts-domain/roster";
import { grids } from "@pe/ducts-domain/tables.fixture";
import { buildCalc } from "./build.ts";

const conn = (i: number, to: [number, number], direction = "out", classification?: string) =>
  connOf(i, to, { ...round(8), direction, classification });
const unit = (id: number, out: number, back: number) => nodeOf(id, "equipment", {
  connectors: [conn(0, [out, 0]), conn(1, [back, 0], "in")],
});
const run = (id: number, from: [number, number], to: [number, number]) => ductOf(id, {
  ...round(8), lengthFt: 10, polyline: [[0, 0, 0], [10, 0, 0]], connectors: [conn(0, from), conn(1, to)],
});
const grille = (id: number, from: number, classification: string) => nodeOf(id, "terminal", {
  connectors: [conn(0, [from, 1], "in", classification)],
});
it("P-114: cycle-dependent hosts are not cached and both evaluation orders give the same claims", () => {
  const snapshot = snapshotOf({ walk: TEST_WALK, nodes: [unit(200, 20, 22), unit(300, 30, 32),
    nodeOf(40, "fitting", { partType: "Tee", connectors: [conn(0, [20, 1]), conn(1, [41, 0]), conn(2, [30, 1])] }),
    grille(42, 41, "SupplyAir"), grille(23, 22, "ReturnAir"), grille(33, 32, "ReturnAir")],
    segments: [run(20, [200, 0], [40, 0]), run(30, [300, 0], [40, 2]), run(41, [40, 1], [42, 0]),
      run(22, [200, 1], [23, 0]), run(32, [300, 1], [33, 0])] });
  const roster: FanPort[] = [200, 300].map(unitId => ({ unitId, portIndex: 0, inletPortIndex: 1,
    tag: String(unitId), side: "supply", kind: "air-handler", source: "ruling" }));
  const inputs = inputsFor(snapshot, { roles: { 200: "fan", 300: "fan" },
    endCfm: { 42: 300, 23: 200, 33: 100, 200: 200, 300: 100 }, drops: { 40: 0.04, 42: 0.03, 23: 0.03, 33: 0.03 } });
  const claims = (order: readonly FanPort[]) => order.map(fan => {
    const claim = buildCalc({ snapshot, fan, roster, grids, inputs,
      encounterRulings: [0, 2].map(connector => ({ at: { elementId: 40, connector },
        verdict: "accepted", by: "human", ref: "work:test" })) }).claim;
    return { unitId: fan.unitId, kind: claim.kind, blockingIds: claim.blockingIds,
      requiredEspInWg: claim.kind === "complete" ? claim.requiredEspInWg : null };
  }).sort((a, b) => a.unitId - b.unitId);
  const set = vi.spyOn(Map.prototype, "set");
  try {
    const forward = claims(roster);
    expect(forward).toEqual(claims([...roster].reverse()));
    expect(forward.map(c => c.kind)).toEqual(["incomplete", "incomplete"]);
    const cachedCycles = set.mock.calls.filter(([key, value]) =>
      ["200:0", "300:0"].includes(key) && value?.claim?.coverage?.some((g: { kind: string }) => g.kind === "cycle"));
    expect(cachedCycles, "ancestor-dependent cycle claims must not escape into the host cache").toEqual([]);
  } finally { set.mockRestore(); }
});

it.each([{ order: [200, 300, 400] }, { order: [400, 300, 200] }])(
  "P-114 m=5: fan 400 reports host 300 incomplete, not a false cycle, in order $order",
  ({ order }) => {
    const tee = (id: number, a: number, b: number, c: number) => nodeOf(id, "fitting", {
      partType: "Tee", connectors: [conn(0, [a, 1]), conn(1, [b, 0]), conn(2, [c, 1])],
    });
    const snapshot = snapshotOf({ walk: TEST_WALK,
      nodes: [unit(200, 20, 22), unit(300, 30, 32), unit(400, 60, 62), tee(40, 20, 41, 30), tee(50, 41, 51, 60),
        grille(52, 51, "SupplyAir"), grille(23, 22, "ReturnAir"), grille(33, 32, "ReturnAir"), grille(63, 62, "ReturnAir")],
      segments: [run(20, [200, 0], [40, 0]), run(30, [300, 0], [40, 2]), run(41, [40, 1], [50, 0]),
        run(60, [400, 0], [50, 2]), run(51, [50, 1], [52, 0]), run(22, [200, 1], [23, 0]),
        run(32, [300, 1], [33, 0]), run(62, [400, 1], [63, 0])] });
    const roster: FanPort[] = [200, 300, 400].map(unitId => ({ unitId, portIndex: 0, inletPortIndex: 1,
      tag: String(unitId), side: "supply", kind: "air-handler", source: "ruling" }));
    const inputs = inputsFor(snapshot, { roles: { 200: "fan", 300: "fan", 400: "fan" },
      endCfm: { 52: 600, 23: 300, 33: 200, 63: 100, 200: 300, 300: 200, 400: 100 },
      drops: { 40: 0.04, 50: 0.04, 52: 0.03, 23: 0.03, 33: 0.03, 63: 0.03 } });
    const calcs = order.map(unitId => buildCalc({ snapshot, fan: { unitId, portIndex: 0 }, roster, grids, inputs,
      encounterRulings: [40, 50].map(elementId => ({ at: { elementId, connector: 0 },
        verdict: "accepted", by: "human", ref: "work:test" })) }));
    const fan400 = calcs.find(calc => calc.fan.unitId === 400)!;
    expect(fan400.claim.coverage).toContainEqual({ kind: "host-calc", elementId: 50,
      ref: "host 300:0 calc is incomplete" });
    expect(fan400.claim.coverage).not.toContainEqual({ kind: "cycle", elementId: 50,
      ref: "host 300:0 calc waits on this fan's own calc" });
  },
);
