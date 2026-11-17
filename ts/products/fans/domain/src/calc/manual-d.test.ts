import { expect, it } from "vite-plus/test";
import raw from "@pe/ducts-domain/fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "@pe/ducts-domain/fixtures/manual-d-tables.json" with { type: "json" };
import { mintWriteRequest } from "./write-request.ts";
import { buildCalc, type CalcSnapshot } from "./build.ts";
import { inputsFor, withFamilyFlipped, withPeersRead } from "@pe/ducts-domain/test-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { friction, roundSection } from "@pe/ducts-domain/loss-physics";
import { lookupGrid, toGrids } from "@pe/ducts-domain/loss-grid";
// u2-w2, controlled snapshot, 2026-11-02 12:06–12:09 UTC; Project A --unsynced keep.
// Read-only walks from MUAS-1, FC-23 and intake plenum 14106988; no model changes/sync.
// Q4 (kaitpw 2026-11-16): MUAS-1's family reads c2 out, c1 in, against its network. Before Q4 the ends chose
// the roles and this capture priced as recorded; now the family does, so the roles the numbers below were
// certified under are stated on the capture. The roster still comes from the capture as read.
const acquired = raw as unknown as CalcSnapshot;
const snapshot = withPeersRead(withFamilyFlipped(acquired, 14577391));
const r = suggestRoster(acquired),
  roster = [...r.fans, ...r.suggestions];
const grids = toGrids({ tables });
function replayInput(id: number, typed = false) {
  return {
    snapshot,
    fan: { unitId: id, portIndex: id === 14577391 ? 2 : 1 },
    roster,
    grids,
    inputs: inputsFor(snapshot, {
      endCfm: id === 14577391 ? { 14577391: 900 } : {},
      drops: { 14577394: 0.0132, 14577396: 0.18, 14088043: 0.026, ...Object.fromEntries(typed ? [[13926753, 0.04]] : []) },
      fittingDrops: typed ? { "proposed:14106988:1|14122436:1>straight": 0.05 } : {},
      rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
    }),
  };
}
const replay = (id: number) => buildCalc(replayInput(id));
it("Manual D real r52 leaves out-of-range legs unpriced", () => {
  // Red loop on the captured geometry: raw-C interpolation reproduces both live refusals.
  expect(
    lookupGrid(grids["SD5-9"]!.Cb!, 35 / 900, (6 / 10) ** 2).value *
      friction(roundSection(6), 35, 0).pv,
  ).toBeCloseTo(1.7905, 4);
  expect(
    lookupGrid(grids["SD5-18"]!.Cb1!, 50 / 865, 1).value * friction(roundSection(10), 50, 0).pv,
  ).toBeCloseTo(2.49, 4);
  const s = replay(14577391);
  // Q4: was network-chosen with no stated family; the family (as stated above) now sets discharge c1.
  expect(s.fan).toMatchObject({ dischargePortIndex: 1, inletPortIndex: 2 });
  expect(Object.values(s.legs).filter(l => l.lossInWg === null).map(l => ({id:l.id, elementId:l.elementId}))).toEqual([
    { id: "13926753:2>1", elementId: 13926753 },
    { id: "heal:14122436:1|14106988:1:fitting>14106988", elementId: 14122436 },
  ]);
  // Was [] and worst paths 2.057835/0.600244, ESP 2.658079; ruling (c), P-102.
  expect(s.blockers.map(({ fitting, detail }) => ({ fitting, detail }))).toEqual([
    { fitting: "13926753", detail: "Ab/Ac 0.11470197078869993 outside table range 0.25..1" },
    { fitting: "proposed:14106988:1|14122436:1>straight",
      detail: expect.stringContaining("Ao/A1 0.08726646259971649 outside table range 0.1..16") },
  ]);
  expect(s.totals.supply.worstPath).toBeNull();
  expect(s.totals.return.worstPath).toBeNull();
  expect(s.totals.requiredEspInWg).toBeNull();
  expect(s.claim.kind).toBe("incomplete");
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

it("Manual D r52 human Work drops close both unpriced legs and permit minting", () => {
  const input = replayInput(14577391, true);
  const unit = input.snapshot.nodes.find((n) => n.id === 14577391)!;
  const parameter = input.snapshot.slots!.requiredEsp!;
  // The old capture lacks cohort evidence: state an instance cohort for this deterministic replay.
  input.snapshot = { ...input.snapshot, parameterCohorts: [{
    parameter, owner: { kind: "instance", id: unit.id },
    members: [{ elementId: unit.id, uniqueId: unit.uniqueId }],
    complete: true, basis: input.snapshot.document.readAt,
  }] };
  const first = buildCalc(input);
  const accepted = { ...input, encounterRulings: first.encounters.map((e) => ({
    at: { elementId: e.elementId, connector: e.connector },
    verdict: "accepted" as const, by: "human" as const, ref: "replay:accepted-tie-in",
  })) };
  const sheet = buildCalc(accepted);
  expect(sheet.blockers).toEqual([]);
  expect(sheet.claim.kind).toBe("complete");
  for (const value of [0.04, 0.05])
    expect(Object.values(sheet.legs).map((l) => l.evidence)).toContainEqual({
      kind: "drop", value: expect.objectContaining({ value, source: "Work", author: "human", ref: "work:test" }),
    });
  if (sheet.claim.kind !== "complete") throw Error("complete replay required");
  const minted = mintWriteRequest(sheet.claim, sheet, accepted, {
    appliedAt: input.snapshot.document.readAt, slots: input.snapshot.slots!,
    peerClaims: new Map(), rulings: {}, storeDeletes: {},
  });
  expect(minted.equipment).toEqual([{ id: 14577391, externalStaticInWg: sheet.claim.requiredEspInWg }]);
});
