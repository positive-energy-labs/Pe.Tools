import { expect, it, vi } from "vite-plus/test";
import { connOf, nodeOf, ductOf, snapshotOf, round } from "@pe/ducts-domain/test-snapshot";
import { inputsFor, TEST_WALK } from "@pe/ducts-domain/test-inputs";
import type { FanPort } from "@pe/ducts-domain/roster";
import { grids } from "@pe/ducts-domain/tables.fixture";
import { buildCalc } from "./build.ts";

it("P-114: cycle-dependent hosts are not cached and both evaluation orders give the same claims", () => {
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
