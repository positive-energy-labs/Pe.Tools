import { inputsFor } from "./test-inputs.ts";
/**
 * R-Q4, A-INFLOW, A-COMPLETE and the three closers of 2026-10-28 (R-SIB siblings, R-CAP capped
 * ends, R-FACE walked pairs; kaitpw / counsel) on the retained raw Chadds snapshot, slot
 * `revit:Flow`. Skipped when the file is absent, like heal-refusal.test.ts.
 *
 * FC-23 (unit 13760867, port 1). Terrain: the supply reaches grilles 8728831, 8728974 and 8728502
 * and exposes open end 8734004:1 (its only neighbour is its own feeder, 13493814); the return
 * follows 13971111 into the shared 32x11 return trunk 13770924, reaches RV-7 (6953852) at its
 * inlet beyond the class change at 13926753, and three parallel 14x3 ReturnAir plenum stubs
 * (14517389, 14663504, 14663546) whose :0 ends each sit 0.01 in from an unconnected SupplyAir
 * grille (14548688, 14663834, 14663850; 294 cfm each) and whose :1 ends are open.
 *
 * Tables are not loaded here (`grids: {}`), so every fitting is `not-priced`; that kind is
 * filtered out of every assertion below. Completeness is computed from blockers, so the final
 * assertions re-price the closed sheet with a constant grid stub (every table, every result =
 * 0.1) to assert `complete` for real.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

import type { ConnectorPairRuling } from "../kernel/inferred-joins.ts";
import type { Grids } from "../loss-grid.ts";
import { suggestRoster } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import { assumedFanFlows } from "./assumed-flow.ts";
import { buildSheet, type BuildSheetInput } from "./build.ts";
import type { EndRuling, Sheet } from "./types.ts";

const CHADDS =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
const FC23 = 13760867;
const OTHER_FC23 = 8732550;
const RV25 = 13770618;
const RV7 = 6953852;

const load = () => {
  const snap = (
    JSON.parse(readFileSync(CHADDS, "utf8").replace(/^\uFEFF/, "")) as { result: DuctSnapshot }
  ).result;
  const r = suggestRoster(snap);
  return { snap, roster: [...r.fans, ...r.suggestions] };
};
const gaps = (bs: Sheet["blockers"]) => bs.filter((b) => b.kind !== "not-priced");
const ids = (bs: Sheet["blockers"]) =>
  gaps(bs)
    .map((b) => b.id)
    .sort();
const noFlow = (s: Sheet) =>
  [...s.blockers, ...s.assumed.blockers].filter((b) => b.kind === "no-flow").map((b) => b.id);
const byKind = (bs: Sheet["blockers"]) =>
  bs.reduce<Record<string, number>>((m, b) => ({ ...m, [b.kind]: (m[b.kind] ?? 0) + 1 }), {});
/** Test-only: every table and result prices at a constant, so completeness is about the walk. */
const CONSTANT = { title: "stub", xLabel: "x", x: [], grid: [0.1] };
const stubGrids = new Proxy({}, { get: () => new Proxy({}, { get: () => CONSTANT }) }) as Grids;

/**
 * The page's loop: accept every proposal and inferred-join candidate, type every unknown drop, and
 * type a path's drop on a proposed fitting no table can price (a join's turn), until nothing new
 * appears. A proposed tee or tap is left to its table.
 */
function closeFromPage(input: BuildSheetInput, seed: ConnectorPairRuling[] = []) {
  const rulings: ConnectorPairRuling[] = [...seed];
  const drops: Record<number, number> = {};
  const fittingDrops: Record<string, number> = {};
  const read = () =>
    buildSheet({ ...input, inputs: inputsFor(input.snapshot, { slot: "revit:Flow", endRulings: input.inputs.rulings.ends, rulings, drops, fittingDrops }) });
  let closed = read();
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const b of [...closed.blockers, ...closed.assumed.blockers]) {
      const row = closed.fittings.find((f) => f.key === b.fitting);
      if (row?.proposed && !row.candidates.length && fittingDrops[row.key] == null) {
        fittingDrops[row.key] = 0.05;
        changed = true;
      }
    }
    for (const b of gaps([...closed.blockers, ...closed.assumed.blockers])) {
      if (b.kind === "unknown-drop" && drops[b.elementId] == null) {
        drops[b.elementId] = 0.05;
        changed = true;
      }
      for (const pair of [
        b.proposal?.pair,
        b.kind === "inferred-join" ? b.closer.candidate?.pair : undefined,
      ])
        if (pair && !rulings.some((r) => r.pair.every((p) => pair.includes(p)))) {
          rulings.push({ pair, verdict: "accept" });
          changed = true;
        }
    }
    if (!changed) break;
    closed = read();
  }
  return { closed, rulings, drops, fittingDrops };
}

it.skipIf(!existsSync(CHADDS))(
  "FC-23 13760867 on Chadds: siblings carry nothing, walked stubs propose each other, a capped end is no end, and the page closes every gap",
  () => {
    const { snap, roster } = load();
    const input: BuildSheetInput = {
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids: {},
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    };
    const sheet = buildSheet(input);

    // R-SIB: RV-7, reached at its inlet 6953852:4 beyond the class change at 13926753 on the
    // return side, is a sibling sharing the trunk, not an outlet share: the `no-flow` it raised
    // (no-flow:13926753:1) is gone and nothing else asks for a share. RV-25, reached at its
    // discharge 13770618:2 beyond 13889080 on the supply side, is a sibling by the same rule.
    expect(noFlow(sheet)).toEqual([]);
    const siblings = sheet.paths.filter((p) => p.end.kind === "sibling-fan");
    expect(siblings.map((p) => `${p.side}:${p.end.elementId}:${p.end.fan!.unitId}`).sort()).toEqual(
      [`return:13926753:${RV7}`, `supply:13889080:${RV25}`],
    );
    expect(sheet.notes).toContainEqual({
      kind: "sibling",
      text: `sibling RV-7 ${RV7}:2 at 13926753: reached at its inlet on this fan's return side; shares the trunk`,
      value: null,
    });
    expect(sheet.notes).toContainEqual({
      kind: "sibling",
      text: `sibling RV-25 ${RV25}:2 at 13889080: reached at its discharge on this fan's supply side; shares the trunk`,
      value: null,
    });
    // Priced to the junction only: every leg but the last is shared with another path on the
    // side; the last (the junction leaving toward the sibling) carries none of this fan's flow.
    // A sibling raises no blocker of its own: every blocker on its path is one the shared trunk
    // already carries (here DH 13760866's unknown drop on the return trunk).
    for (const p of siblings) {
      const others = sheet.paths.filter((q) => q !== p && q.side === p.side);
      for (const id of p.legIds.slice(0, -1))
        expect(
          others.some((q) => q.legIds.includes(id)),
          `${p.side} ${id}`,
        ).toBe(true);
      expect(sheet.legs[p.legIds.at(-1)!]).toMatchObject({ flowCfm: 0, lossInWg: 0 });
      for (const b of p.blockerIds)
        expect(
          others.some((q) => q.blockerIds.includes(b)),
          `${p.side} ${b}`,
        ).toBe(true);
    }
    // A-INFLOW kept where air arrives: RV-25's discharge is also reached on the return side, at
    // 13975612, and stays a source there.
    expect(sheet.notes).toContainEqual({
      kind: "inflow",
      text: `inflow from RV-25 ${RV25}:2 at 13975612: unknown; 0 assumed`,
      value: 0,
    });

    // Every supply path ends at a terminal, an open end, or a named fan.
    const supply = sheet.paths.filter((p) => p.side === "supply");
    expect(supply.length).toBeGreaterThan(0);
    for (const p of supply) {
      const ok =
        p.end.kind === "terminal" ||
        p.end.kind === "open-end" ||
        ((p.end.kind === "roster-fan-port" ||
          p.end.kind === "joins-other-fan" ||
          p.end.kind === "sibling-fan") &&
          !!p.end.fan);
      expect(ok, `${p.end.kind} ${p.end.elementId} fan=${JSON.stringify(p.end.fan)}`).toBe(true);
    }
    expect(
      supply
        .filter((p) => p.end.kind === "terminal")
        .map((p) => p.end.elementId)
        .sort((a, b) => a - b),
    ).toEqual([8728502, 8728554, 8728636, 8728831, 8728974, 13883887]);
    expect(supply.some((p) => p.end.kind === "open-end" && p.end.elementId === 8734004)).toBe(true);

    // The trunk's open end is still raised, with its heal.
    const trunk = sheet.blockers.find((b) => b.id === "open-end:13771256:0")!;
    expect(trunk.closer.kind).toBe("heal");
    expect(trunk.proposal).toMatchObject({ kind: "tee", pair: ["13771256:0", "13771267:1"] });

    // R-FACE: the plenum stubs are walked, and each :1 end now proposes the other's vacant :1
    // (17.56 in apart, parallel, so a fitting change); before, `proposeHeals` never saw a walked
    // element and these ends had a candidate but no proposal. 8734004:1 keeps no proposal: a
    // tap onto its own walked feeder would loop back, and taps/tees onto walked elements stay out.
    expect(sheet.blockers.find((b) => b.id === "inferred-join:14663504:1")!.proposal).toMatchObject(
      { kind: "join", pair: ["14663504:1", "14663546:1"], fittingChange: true },
    );
    expect(sheet.blockers.find((b) => b.id === "inferred-join:14663546:1")!.proposal).toMatchObject(
      { kind: "join", pair: ["14663546:1", "14663504:1"] },
    );
    expect(sheet.blockers.find((b) => b.id === "open-end:8734004:1")!.proposal).toBeUndefined();

    // R-CAP: 8734004:1 ruled capped is no end and no blocker in either pass, with one input line.
    const endRulings: EndRuling[] = [
      { end: { elementId: 8734004, connector: 1 }, verdict: "capped" },
    ];
    const capped = buildSheet({ ...input, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }) });
    expect(
      [...capped.blockers, ...capped.assumed.blockers].some((b) => b.elementId === 8734004),
    ).toBe(false);
    expect(
      [...capped.paths, ...capped.assumed.paths].some((p) => p.end.elementId === 8734004),
    ).toBe(false);
    expect(capped.notes).toContainEqual({
      kind: "capped",
      text: "open end 8734004:1 ruled capped",
      value: null,
    });
    expect(capped.basis).not.toBe(sheet.basis);

    // Close from the page: accept every proposal and inferred-join candidate as it appears, type
    // every unknown drop, cap 8734004:1, and nothing else.
    const blind = closeFromPage({ ...input, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }) });
    expect(blind.rulings.map((r) => r.pair.join(">"))).toEqual([
      "13771256:0>13771267:1",
      "14517389:0>14663504:0",
      "14663546:0>14663504:0",
      "14663546:1>14663504:1",
      "13970017:1>14041958:1",
      "13970017:1>13770924",
      "14041958:1>13770924",
      "14663546:0>14663850:1",
    ]);
    expect(
      Object.keys(blind.drops)
        .map(Number)
        .sort((x, y) => x - y),
    ).toEqual([13760866]);
    // kaitpw 2026-10-29: the tee at 13771256:0 is a fitting priced by its table per path, never a
    // combined drop on 13771256; only the stubs' joins (a turn with no geometry) take typed path drops.
    expect(Object.keys(blind.fittingDrops)).toEqual(["proposed:14663546:0|14663850:1>14663850"]);
    expect(ids(blind.closed.blockers)).toEqual([]);
    expect(ids(blind.closed.assumed.blockers)).toEqual([]);
    // 72 -> 73 (2026-10-29): the proposed tee at 13771256:0 is a fitting, unpriced on this grid-less read.
    expect(byKind(blind.closed.blockers)).toEqual({ "not-priced": 73 });
    expect(byKind(blind.closed.assumed.blockers)).toEqual({ "not-priced": 73 });
    // Honest reading of that closure: the blind loop accepts the same-class stub 17 in away
    // before the cross-class grille 0.01 in away (an unruled crossing never heads a candidate
    // list), so the plenums close in series, 14517389 -> 14663504 -> 14663546 -> grille 14663850.
    const returnTerminals = (s: Sheet) =>
      s.paths
        .filter((p) => p.side === "return" && p.end.kind === "terminal")
        .map((p) => p.end.elementId)
        .sort((a, b) => a - b);
    expect(returnTerminals(blind.closed)).toEqual([13884018, 14584961, 14663850]);
    // Completeness for real, on the constant grid stub: zero blockers of any kind, both sides complete.
    const blindPriced = buildSheet({ ...input, grids: stubGrids, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings, rulings: blind.rulings, drops: blind.drops, fittingDrops: blind.fittingDrops }) });
    expect(blindPriced.blockers).toEqual([]);
    expect(blindPriced.assumed.blockers).toEqual([]);
    expect(blindPriced.totals.supply.complete && blindPriced.totals.return.complete).toBe(true);
    // 2.2049 before 2026-10-28 evening: the volume dampers' 1.0 in-wg family default (all 252 round,
    // all 49 square) was priced as designer-stated; demoted, they take CD9-1/CR9-1 (0.1 on the stub).
    // 0.3817 -> 0.4213 the same evening: converging tap Cb re-referenced to the common section.
    // 0.4213 -> 0.3765 later that evening: converging takeoffs on ER5-1 with Cb on the branch Pv
    // (no stated-geometry factor on the stub's axis-free grid) and the split taps as bullheads (Cb1
    // on the larger main stream).
    // 0.3765 -> 0.3335 (2026-10-29): the proposed tee is priced on its table (the stub) per path
    // instead of a typed 0.05 combined drop on 13771256, which keeps only its own loss.
    // fix6 (2026-10-29): the one-way supply splits at 13885163, 9448322 and 9448375 now read Qc as
    // the real collar total (Qb/Qc 1) instead of 2x the collar flow (0.5). The total does not move
    // (0.33352 before and after): the stub grid reads one coefficient at every flow ratio, so this pin
    // cannot see a ratio change; sheet.test.ts (R-Q4, one way) carries that proof on real SD5-9.
    expect(blindPriced.totals.requiredEspInWg).toBeCloseTo(0.3335, 3);

    // The per-plenum closure: accept each stub's own grille first (the pair each inferred-join
    // names once its stub neighbour is taken), then the same loop. Each plenum ends at its grille.
    const seeded = closeFromPage({ ...input, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }) }, [
      { pair: ["14517389:0", "14548688:1"], verdict: "accept" },
      { pair: ["14663504:0", "14663834:1"], verdict: "accept" },
      { pair: ["14663546:0", "14663850:1"], verdict: "accept" },
    ]);
    expect(ids(seeded.closed.blockers)).toEqual([]);
    expect(ids(seeded.closed.assumed.blockers)).toEqual([]);
    expect(returnTerminals(seeded.closed)).toEqual([
      13884018, 14548688, 14584961, 14663834, 14663850,
    ]);
    const seededPriced = buildSheet({ ...input, grids: stubGrids, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings, rulings: seeded.rulings, drops: seeded.drops, fittingDrops: seeded.fittingDrops }) });
    expect(seededPriced.blockers).toEqual([]);
    expect(seededPriced.totals.supply.complete && seededPriced.totals.return.complete).toBe(true);
    // 0.7079 -> 0.8062 the same evening: converging tap Cb re-referenced to the common section;
    // 0.8062 -> 0.6969 later: ER5-1 on the branch Pv and the split taps as bullheads (see above).
    // 0.6969 -> 0.6539 (2026-10-29): the proposed tee on its table per path, as above.
    expect(seededPriced.totals.requiredEspInWg).toBeCloseTo(0.6539, 3); // 2.2054 with the 1.0 damper default
  },
  240_000,
);

it.skipIf(!existsSync(CHADDS))(
  "FC-23 8732550 on Chadds: the takeoff onto its own trunk is a split; the known walk reaches both open ends with no flow gap",
  () => {
    const { snap, roster } = load();
    const sheet = buildSheet({
      snapshot: snap,
      fan: { unitId: OTHER_FC23, portIndex: 1 },
      roster,
      grids: {},
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    });
    const supply = sheet.paths.filter((p) => p.side === "supply");
    expect(supply.map((p) => `${p.end.kind}:${p.end.elementId}:${p.end.connector}`).sort()).toEqual(
      ["open-end:13756998:0", "open-end:8738359:1"],
    );
    const all = [...sheet.blockers, ...sheet.assumed.blockers];
    expect(sheet.blockers.some((b) => b.kind === "no-flow")).toBe(false);
    expect(all.some((b) => b.elementId === 13415684)).toBe(false);
    // The assumed pass still asks one share: beyond the assumed join at 8738359:1 this fan's supply
    // enters a return stream at the class change 13342116 (an outlet, unnamed); it cites its cause.
    expect(sheet.assumed.blockers.filter((b) => b.kind === "no-flow")).toMatchObject([
      { id: "no-flow:13342116:0", causedBy: "inferred-join:8738359:1" },
    ]);
    expect(sheet.walkedElementIds).toContain(13415684);
    expect(sheet.walkedElementIds).toContain(12871538);
  },
  120_000,
);

it.skipIf(!existsSync(CHADDS))(
  "FC-23 13760867 on Chadds: each ReturnAir stub's :0 end carries its SupplyAir grille as closer.crossing",
  () => {
    const { snap, roster } = load();
    const sheet = buildSheet({
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids: {},
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    });
    const all = [...sheet.blockers, ...sheet.assumed.blockers];
    for (const [stub, grille] of [
      [14517389, 14548688],
      [14663504, 14663834],
      [14663546, 14663850],
    ] as const) {
      const b = all.find((x) => x.elementId === stub && x.connector === 0);
      expect(b, `blocker at ${stub}:0`).toBeDefined();
      expect(b!.closer.crossing, `${stub}:0`).toMatchObject({
        toElementId: grille,
        distanceIn: expect.any(Number),
        classes: [expect.stringMatching(/Return/), expect.stringMatching(/Supply/)],
      });
      expect(b!.closer.crossing!.distanceIn).toBeLessThan(0.1);
    }
  },
  120_000,
);

// Verbatim from the live `ducts.tables` op (Revit's shipped .tbl files, 2026-10-28); CD9-1 keeps its
// Theta 0 column only (Co 0.19 at every D/Do), which is all a fully open damper reads.
const LIVE: Grids = {
  "ER5-2": {
    Cb: {
      title: "ER5-2 Tee, Round Tap to Rectangular Main, Converging (SMACNA 1990)",
      xLabel: "Qb/Qc",
      x: [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      grid: [-1550, -14, -2.38, 0.5, 0.65, 1.03, 1.17, 1.19, 1.33, 1.51, 1.44],
    },
    Cs: {
      title: "ER5-2 Tee, Round Tab to Rectangular Main, Converging (SEPSY 1973)",
      xLabel: "Qs/Qc",
      x: [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      grid: [38.2, 22.15, 11.91, 6.54, 3.74, 2.23, 1.33, 0.76, 0.38, 0.1, 0],
    },
  },
  "CD9-1": {
    Co: {
      title: "CD9-1 Damper, Butterfly",
      xLabel: "Theta",
      x: [0, 90],
      yLabel: "D/Do",
      y: [0.5, 1],
      grid: [
        [0.19, 1.04],
        [0.19, 99999],
      ],
    },
  },
  "CR9-1": {
    Co: {
      title: "CR9-1 Damper, Butterfly",
      xLabel: "Theta",
      x: [0, 10, 20, 30, 40, 50, 60, 65, 70, 90],
      yLabel: "H/W",
      y: [0.12, 0.25, 1, 2],
      grid: [
        [0.04, 0.3, 1.1, 3, 8, 23, 60, 100, 190, 99999],
        [0.08, 0.33, 1.18, 3.3, 9, 26, 70, 128, 210, 99999],
        [0.08, 0.33, 1.18, 3.3, 9, 26, 70, 128, 210, 99999],
        [0.13, 0.35, 1.25, 3.6, 10, 29, 80, 155, 230, 99999],
      ],
    },
  },
};
const unknownErv = (ref: string) => ({
  cfm: 0,
  source: `unknown (0 assumed): ERV ${ref}'s discharge reaches no terminal it supplies; type the unit design flow`,
});

it.skipIf(!existsSync(CHADDS))(
  "assumed fan flow on Chadds: FC-23, RV-25 and RV-7 no longer share one value; an ERV whose discharge reaches no terminal is unknown",
  () => {
    const { snap, roster } = load();
    const inputs = inputsFor(snap, { slot: "revit:Flow" });
    const flows = assumedFanFlows(snap, roster, (id) => inputs.terminals[String(id)]?.cfm.value ?? null, JSON.stringify(inputs.terminals), {});
    const fc = flows.get(`${FC23}:1`)!;
    const rv25 = flows.get(`${RV25}:2`)!;
    const rv7 = flows.get(`${RV7}:2`)!;
    // Before (2026-10-28) all three read 1355 cfm over the same 8 terminals: every fan on the shared
    // connected network was credited with every terminal in it. Now FC-23 keeps its own supply's six.
    expect(fc).toEqual({
      cfm: 942,
      source: "derived from served terminals (assumed); 6 covered terminals",
    });
    // RV-25's discharge merges into FC-23's return and RV-7's into another fan's inlet: neither
    // supplies a terminal through its own discharge, so neither borrows a sum.
    expect(rv25).toEqual(unknownErv(`${RV25}:2`));
    expect(rv7).toEqual(unknownErv(`${RV7}:2`));
    expect(fc.cfm).not.toBe(rv25.cfm);
    expect(new Set([fc, rv25, rv7].map((f) => f.source)).size).toBe(3);

    const sheet = buildSheet({
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids: {},
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    });
    expect(sheet.notes).toContainEqual({
      kind: "assumed-flow",
      text: `fan ${RV25}:2 cfm (assumed): ${unknownErv(`${RV25}:2`).source}`,
      value: 0,
    });
  },
  120_000,
);

it.skipIf(!existsSync(CHADDS))(
  "FC-23 on Chadds: return takeoffs price on ER5-2, and the volume dampers' 1.0 in-wg family default is demoted",
  () => {
    const { snap, roster } = load();
    const input: BuildSheetInput = {
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids: LIVE,
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    };
    const sheet = buildSheet(input);

    // 1. Converging: every return-side junction leg is off SD5-9; 13971115 (12x8 on the 32x11
    // trunk, walked main to branch) reads ER5-2 Cb, its row stating the Ab/Ac gap.
    const returnLegs = [
      ...new Set(sheet.paths.filter((p) => p.side === "return").flatMap((p) => p.legIds)),
    ].map((id) => sheet.legs[id]!);
    expect(returnLegs.filter((l) => /SD5-9/.test(l.lossSource.ref))).toEqual([]);
    expect(sheet.legs["13971115:0>1"]!.lossSource).toMatchObject({
      kind: "rule",
      ref: expect.stringMatching(/^tap-converging-rect ER5-2 Cb=/),
    });
    expect(
      sheet.notes.some((i) => /diverging-table/.test(i.text)),
    ).toBe(false);

    // 3. The supply's round volume damper 13493795 is no longer the 1.0 in-wg "designer-stated" row:
    // fully open CD9-1 (Co 0.19 at Theta 0), one input line per demoted family.
    expect(sheet.legs["13493795:2>1"]!.lossSource.ref).toMatch(/^damper CD9-1 Co=0\.19/);
    expect(
      Object.values(sheet.legs).some((l) => l.lossSource.ref === "parameter:pressureDrop"),
    ).toBe(false);
    for (const [family, n] of [
      ["Damper_Volume_Round", 252],
      ["Damper_Volume_Square", 49],
    ] as const)
      expect(
        snap.nodes.filter((node) => node.family === family).map((node) => input.inputs.components[String(node.id)]?.drop),
      ).toEqual(Array.from({ length: n }, () => ({ value: null, source: "none", ref: `family placeholder 1 on ${n}` })));

    // A demoted family no rule prices raises unknown-drop with the family default in its note.
    const renamed = {
      ...snap,
      nodes: snap.nodes.map((n) =>
        n.family === "Damper_Volume_Round" ? { ...n, family: "Volume Widget" } : n,
      ),
    };
    const widget = buildSheet({ ...input, snapshot: renamed, inputs: inputsFor(renamed, { slot: "revit:Flow" }) });
    expect(widget.blockers).toContainEqual(
      expect.objectContaining({
        id: "unknown-drop:13493795",
        detail:
          "accessory has no drop (family placeholder 1 on 252; type the real drop)",
      }),
    );
  },
  240_000,
);
