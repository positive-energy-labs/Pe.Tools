import { expect, it } from "vite-plus/test";
import raw from "./fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "./fixtures/manual-d-tables.json" with { type: "json" };
import { buildSheet, type SheetSnapshot } from "./build.ts";
import { inputsFor } from "./test-inputs.ts";
import { suggestRoster } from "../roster.ts";
import { friction, roundSection } from "../loss-physics.ts";
import { lookupGrid, toGrids } from "../loss-grid.ts";
// u2-w2, controlled snapshot, 2026-11-02 12:06–12:09 UTC; Project A --unsynced keep.
// Read-only walks from MUAS-1, FC-23 and intake plenum 14106988; no model changes/sync.
const snapshot = raw as unknown as SheetSnapshot;
const r = suggestRoster(snapshot),
  roster = [...r.fans, ...r.suggestions];
const grids = toGrids({ tables });
function replay(id: number) {
  return buildSheet({
    snapshot,
    fan: { unitId: id, portIndex: id === 14577391 ? 2 : 1 },
    roster,
    grids,
    inputs: inputsFor(snapshot, {
      endCfm: id === 14577391 ? { 14577391: 900 } : {},
      drops: { 14577394: 0.0132, 14577396: 0.18, 14088043: 0.026 },
      rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
    }),
  });
}
it("Manual D real r52 taps price and both MUAS sides complete", () => {
  // Red loop on the captured geometry: raw-C interpolation reproduces both live refusals.
  expect(
    lookupGrid(grids["SD5-9"]!.Cb!, 35 / 900, (6 / 10) ** 2).value *
      friction(roundSection(6), 35, 0).pv,
  ).toBeCloseTo(1.7905, 4);
  expect(
    lookupGrid(grids["SD5-18"]!.Cb1!, 50 / 865, 1).value * friction(roundSection(10), 50, 0).pv,
  ).toBeCloseTo(2.49, 4);
  const s = replay(14577391);
  expect(s.blockers).toEqual([]);
  expect(s.totals.supply.worstPath).toBeCloseTo(2.057835, 6);
  expect(s.totals.return.worstPath).toBeCloseTo(0.600244, 6);
  expect(s.totals.requiredEspInWg).toBeCloseTo(2.658079, 6);
  const tap = s.legs["14682361:1>2"]!,
    bull = s.legs["14806947:2>1>14806824"]!;
  expect(tap.flowCfm).toBe(35);
  expect(tap.lossInWg).toBeCloseTo(0.173027, 6);
  expect(bull.flowCfm).toBe(50);
  expect(bull.lossInWg).toBeCloseTo(0.155905, 6);
  expect(tap.lossSource.ref).toContain("fixed velocity pressure");
  expect(bull.lossSource.ref).toContain("SD5-18 Cb1");
});
// TODO: resolve the physical supply ends 8734004:1 and 13771256:0 with model intent;
// neither end establishes 258 cfm of missing demand. Do not auto-join occupied neighbours.
it("FC-23 names the model/terminal disagreement and preserves unresolved physical ends", () => {
  const s = replay(13760867);
  expect(s.notes.find((n) => n.kind === "flow-conflict")).toMatchObject({
    value: 258,
    text: expect.stringContaining("1200 cfm (model:PE_M_Fan_AirFlow) conflicts with 942 cfm"),
  });
  expect(
    s.blockers
      .filter((b) => b.kind === "open-end")
      .map((b) => b.id)
      .sort(),
  ).toEqual(["open-end:13771256:0", "open-end:8734004:1"]);
  expect(s.paths.filter((p) => p.end.kind === "open-end").every((p) => p.side === "supply")).toBe(
    true,
  );
  expect(s.totals.requiredEspInWg).toBeNull();
});
