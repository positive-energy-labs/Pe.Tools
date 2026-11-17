import { afterEach, expect, it, vi } from "vite-plus/test";
import raw from "@pe/ducts-domain/fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "@pe/ducts-domain/fixtures/manual-d-tables.json" with { type: "json" };
import { inputsFor, withFamilyFlipped } from "@pe/ducts-domain/test-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import * as pricing from "@pe/ducts-domain/kernel/price-leg";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { VOCABULARY } from "@pe/ducts-domain/calc/scoped-snapshot";
import { buildCalc } from "./build.ts";

afterEach(() => vi.restoreAllMocks());

const loadSnapshot = () => nativeResponseSchema("ducts.snapshot.walk").parse({
  ...structuredClone(raw), vocabulary: VOCABULARY, walk: { ...raw.walk, unreadPeers: [] },
});

function replay(unitId: number, mirrored = false, supply = false) {
  let snapshot = loadSnapshot();
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
  // Host inspection can price the same physical piece from its other end: length differs at roundoff only.
  return pieces.filter((p, i) => pieces.findIndex(q => q.cfm === p.cfm &&
    Math.abs((q.length ?? 0) - (p.length ?? 0)) < 1e-12 && Math.abs((q.drop ?? 0) - (p.drop ?? 0)) < 1e-12) === i);
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

it("P-106: a sibling-only tap charges straight Cs and names the passed tap on the shared leg", () => {
  const snapshot = loadSnapshot();
  const roster = suggestRoster(snapshot);
  // Keep the retained topology but state one-tenth flow so its small tap stays below the velocity refusal.
  const model = inputsFor(snapshot, {});
  const endCfm = Object.fromEntries([...Object.entries(model.units), ...Object.entries(model.terminals)]
    .flatMap(([id, row]) => row.cfm.value == null ? [] : [[id, row.cfm.value / 10]]));
  const price = vi.spyOn(pricing, "priceLeg");
  const sheet = buildCalc({ snapshot, fan: { unitId: 12806600, portIndex: 2 },
    roster: [...roster.fans, ...roster.suggestions], inputs: inputsFor(snapshot, { endCfm }), grids: toGrids({ tables }) });
  const leg = Object.values(sheet.legs).find(l => l.elementId === 14085956 && l.lossSource.kind === "friction")!;
  // RV-30 owns the branch at 14086100; RV-27 only passes it on its shared duct.
  expect(Object.values(sheet.legs).some(l => l.elementId === 14086100)).toBe(false);
  const straight = price.mock.calls.findIndex(([p]) =>
    p.kind === "fitting" && p.fitting.id === 14086100 && p.leg === "Cs");
  expect(straight).toBeGreaterThanOrEqual(0);
  const cs = price.mock.results[straight]!.value.lossInWg;
  expect(cs, JSON.stringify(price.mock.results[straight]!.value)).not.toBeNull();
  expect(cs).not.toBe(0);
  const friction = price.mock.calls.flatMap(([p], i) =>
    p.kind === "duct" && p.segment.id === 14085956 ? [price.mock.results[i]!.value.lossInWg] : []).slice(0, 2);
  expect(leg.lossInWg).toBeCloseTo(friction.reduce((sum, loss) => sum + loss, 0) + cs, 12);
  // The source line discloses passed taps; the evidence ref names the friction method, Altshul-Tsal.
  expect(leg.lossSource.ref).toContain("1 tap(s) passed (Cs: 14086100)");
  expect(leg.evidence.kind).toBe("friction");
});

it.each([false, true])("P-107: typed branch drop replaces Cs only when refused=%s", refused => {
  const snapshot = loadSnapshot();
  const roster = suggestRoster(snapshot);
  const model = inputsFor(snapshot, {});
  const endCfm = Object.fromEntries([...Object.entries(model.units), ...Object.entries(model.terminals)]
    .flatMap(([id, row]) => row.cfm.value == null ? [] : [[id, row.cfm.value / 10]]));
  const grids = refused ? {} : toGrids({ tables });
  const input = { snapshot, fan: { unitId: 12806600, portIndex: 2 },
    roster: [...roster.fans, ...roster.suggestions], grids };
  const before = buildCalc({ ...input, inputs: inputsFor(snapshot, { endCfm }) });
  const price = vi.spyOn(pricing, "priceLeg");
  const after = buildCalc({ ...input, inputs: inputsFor(snapshot, { endCfm, drops: { 14086100: 0.123 } }) });
  const leg = (sheet: typeof after) => Object.values(sheet.legs)
    .find(l => l.elementId === 14085956 && l.lossSource.kind === "friction")!;
  if (!refused) {
    expect(leg(after).lossInWg).toBe(leg(before).lossInWg);
    const index = price.mock.calls.findIndex(([p]) => p.kind === "fitting" && p.fitting.id === 14086100 && p.leg === "Cs");
    expect(price.mock.results[index]!.value.source).toMatchObject({ kind: "rule", table: "SD5-9" });
  } else {
    expect(leg(before).lossInWg).toBeNull();
    const friction = price.mock.calls.flatMap(([p], i) =>
      p.kind === "duct" && p.segment.id === 14085956 ? [price.mock.results[i]!.value.lossInWg] : []).slice(0, 2);
    expect(leg(after).lossInWg).toBeCloseTo(friction.reduce((sum, loss) => sum + loss, 0) + 0.123, 12);
    expect(leg(after).lossSource.ref).toContain("typed drop from 14086100 (Cs refused: SD5-9 Cs is not loaded)");
    expect(leg(after).lossSource.ref).toContain("); Work");
  }
});
