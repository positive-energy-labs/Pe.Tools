import { afterEach, expect, it, vi } from "vite-plus/test";
import raw from "@pe/ducts-domain/fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "@pe/ducts-domain/fixtures/manual-d-tables.json" with { type: "json" };
import { inputsFor, withFamilyFlipped } from "@pe/ducts-domain/test-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import * as pricing from "@pe/ducts-domain/kernel/price-leg";
import { buildCalc, type CalcSnapshot } from "./build.ts";

afterEach(() => vi.restoreAllMocks());

function replay(unitId: number, mirrored = false, supply = false) {
  let snapshot = structuredClone(raw) as unknown as CalcSnapshot;
  if (supply) {
    for (const id of [12777429, 12806600]) snapshot = withFamilyFlipped(snapshot, id);
  }
  const duct = snapshot.segments.find(d => d.id === 14085956)!;
  if (mirrored) {
    // Exchange the end connections while retaining the physical tap station and polyline.
    const a = duct.connectors.find(c => c.index === 0)!;
    const b = duct.connectors.find(c => c.index === 1)!;
    [a.connectedTo, b.connectedTo] = [b.connectedTo, a.connectedTo];
    for (const c of [a, b]) {
      const peer = snapshot.nodes.find(n => n.id === c.connectedTo!.elementId)!;
      peer.connectors.find(p => p.index === c.connectedTo!.connector)!.connectedTo!.connector = c.index;
    }
  }
  const r = suggestRoster(snapshot);
  const price = vi.spyOn(pricing, "priceLeg");
  buildCalc({ snapshot, fan: { unitId, portIndex: supply ? 4 : 2 }, roster: [...r.fans, ...r.suggestions],
    inputs: inputsFor(snapshot, {}), grids: toGrids({ tables }) });
  const pieces = price.mock.calls.flatMap(([input], i) =>
    input.kind === "duct" && input.segment.id === duct.id
      ? [{ length: input.lengthFt, cfm: input.cfm, drop: price.mock.results[i]!.value.lossInWg }]
      : []);
  if (unitId === 12806600) {
    const straight = price.mock.calls.map(([input]) => input).find(input =>
      input.kind === "fitting" && input.fitting.id === 14086100 && input.leg === "Cs");
    expect(straight?.kind === "fitting" && !!straight.facts.converging).toBe(supply);
    expect(straight).toMatchObject({ flows: {
      branch: 65, upstreamMain: supply ? 1220 : 1020, downstreamMain: supply ? 1155 : 955,
    } });
  }
  price.mockRestore();
  // The actual and assumed-topology calculations price the same unchanged duct.
  return pieces.filter((p, i) => pieces.findIndex(q => JSON.stringify(q) === JSON.stringify(p)) === i);
}

it("R-SHARE RV-27 excludes RV-30's 65 cfm until tap 14086100", () => {
  const pieces = replay(12806600);
  expect(pieces.map(p => p.cfm)).toEqual([955, 1020]);
  expect(pieces.map(p => p.length)).toEqual([
    expect.closeTo(0.43840000351641584, 8), expect.closeTo(1.863899996483584, 8),
  ]);
});

it("R-SHARE RV-30 and RV-27 price their common c2-to-c1 piece identically", () => {
  const rv30 = replay(12777429);
  const rv27 = replay(12806600);
  expect(rv27[1]).toEqual(rv30.find(p => Math.abs(p.length! - 1.863899996483584) < 1e-8));
});

it("R-SHARE mirrored walk from c1 adds the sibling only after c2", () => {
  const pieces = replay(12806600, true);
  expect(pieces.map(p => p.cfm)).toEqual([955, 1020]);
  expect(pieces.map(p => p.length)).toEqual([
    expect.closeTo(1.863899996483584, 8), expect.closeTo(0.43840000351641584, 8),
  ]);
});

it.each([false, true])("R-SHARE supply co-supplier joins at the physical tap, mirrored=%s", mirrored => {
  const pieces = replay(12806600, mirrored, true);
  // Reversing these families changes the other shared consumers: the resolved total is 1220.
  expect(pieces.map(p => p.cfm)).toEqual([1155, 1220]);
});
