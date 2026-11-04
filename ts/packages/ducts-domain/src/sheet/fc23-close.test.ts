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
 * Grid-less reads isolate topology blockers. Constant-grid reads then prove that closing
 * geometry and pricing fittings still withhold totals until the missing inflows are measured.
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
    buildSheet({
      ...input,
      inputs: inputsFor(input.snapshot, {
        slot: "revit:Flow",
        endRulings: input.inputs.rulings.ends,
        rulings,
        drops,
        fittingDrops,
      }),
    });
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
  "FC-23 13760867 on Chadds: siblings carry nothing, walked stubs propose each other, a capped end is no end, and closing topology retains missing inflows",
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
    // ba4fd56c (G7): unnamed/ERV inflows remain missing on both passes.
    expect(noFlow(sheet).sort()).toEqual([
      "no-flow:13771684:0",
      "no-flow:13771684:0",
      "no-flow:13975612:1",
      "no-flow:13975612:1",
    ]);
    const siblings = sheet.paths.filter((p) => p.end.kind === "sibling-fan");
    expect(siblings.map((p) => `${p.side}:${p.end.elementId}:${p.end.fan!.unitId}`).sort()).toEqual(
      [`return:13926753:${RV7}`, `supply:13889080:${RV25}`],
    );
    // 0f304f4f: visible notes name the element rather than leaking connector ids.
    expect(sheet.notes).toContainEqual({
      kind: "sibling",
      text: `sibling RV-7 at 10\u2033 tapadjustable: reached at its inlet on this fan's return side; shares the trunk`,
      value: null,
    });
    expect(sheet.notes).toContainEqual({
      kind: "sibling",
      text: `sibling RV-25 at 10\u2033 duct: reached at its discharge on this fan's supply side; shares the trunk`,
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
      text: `inflow from RV-25 at 6\u2033 tapadjustable: missing flow`,
      value: null,
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
    const capped = buildSheet({
      ...input,
      inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }),
    });
    expect(
      [...capped.blockers, ...capped.assumed.blockers].some((b) => b.elementId === 8734004),
    ).toBe(false);
    expect(
      [...capped.paths, ...capped.assumed.paths].some((p) => p.end.elementId === 8734004),
    ).toBe(false);
    expect(capped.notes).toContainEqual({
      kind: "capped",
      text: "an open end on 12\u2033x6\u2033 duct ruled capped",
      value: null,
    });
    expect(capped.basis).not.toBe(sheet.basis);

    // Close from the page: accept every proposal and inferred-join candidate as it appears, type
    // every unknown drop, cap 8734004:1, and nothing else.
    const blind = closeFromPage({
      ...input,
      inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }),
    });
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
    // ba4fd56c (G7): closing geometry does not supply missing inflow measurements.
    const missing = ["no-flow:13771684:0", "no-flow:13975612:1"];
    expect(ids(blind.closed.blockers)).toEqual(missing);
    expect(ids(blind.closed.assumed.blockers)).toEqual(missing);
    // Honest reading of that closure: the blind loop accepts the same-class stub 17 in away
    // before the cross-class grille 0.01 in away (an unruled crossing never heads a candidate
    // list), so the plenums close in series, 14517389 -> 14663504 -> 14663546 -> grille 14663850.
    const returnTerminals = (s: Sheet) =>
      s.paths
        .filter((p) => p.side === "return" && p.end.kind === "terminal")
        .map((p) => p.end.elementId)
        .sort((a, b) => a - b);
    expect(returnTerminals(blind.closed)).toEqual([13884018, 14584961, 14663850]);
    // A priced table cannot certify a complete total while inflows are missing.
    const blindPriced = buildSheet({
      ...input,
      grids: stubGrids,
      inputs: inputsFor(snap, {
        slot: "revit:Flow",
        endRulings,
        rulings: blind.rulings,
        drops: blind.drops,
        fittingDrops: blind.fittingDrops,
      }),
    });
    expect(ids(blindPriced.blockers)).toEqual(missing);
    expect(ids(blindPriced.assumed.blockers)).toEqual(missing);
    expect(blindPriced.blockers.every((b) => b.kind === "no-flow")).toBe(true);
    expect(blindPriced.totals.return.complete).toBe(false);
    expect(blindPriced.totals.requiredEspInWg).toBeNull();

    // The per-plenum closure: accept each stub's own grille first (the pair each inferred-join
    // names once its stub neighbour is taken), then the same loop. Each plenum ends at its grille.
    const seeded = closeFromPage(
      { ...input, inputs: inputsFor(snap, { slot: "revit:Flow", endRulings }) },
      [
        { pair: ["14517389:0", "14548688:1"], verdict: "accept" },
        { pair: ["14663504:0", "14663834:1"], verdict: "accept" },
        { pair: ["14663546:0", "14663850:1"], verdict: "accept" },
      ],
    );
    expect(ids(seeded.closed.blockers)).toEqual(missing);
    expect(ids(seeded.closed.assumed.blockers)).toEqual(missing);
    expect(returnTerminals(seeded.closed)).toEqual([
      13884018, 14548688, 14584961, 14663834, 14663850,
    ]);
    const seededPriced = buildSheet({
      ...input,
      grids: stubGrids,
      inputs: inputsFor(snap, {
        slot: "revit:Flow",
        endRulings,
        rulings: seeded.rulings,
        drops: seeded.drops,
        fittingDrops: seeded.fittingDrops,
      }),
    });
    expect(ids(seededPriced.blockers)).toEqual(missing);
    expect(seededPriced.blockers.every((b) => b.kind === "no-flow")).toBe(true);
    expect(seededPriced.totals.return.complete).toBe(false);
    expect(seededPriced.totals.requiredEspInWg).toBeNull();
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
      { id: "no-flow:8738359:1", causedBy: "inferred-join:8732550:3" },
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
it.skipIf(!existsSync(CHADDS))(
  "assumed fan flow on Chadds: FC-23, RV-25 and RV-7 no longer share one value; an ERV whose discharge reaches no terminal is unknown",
  () => {
    const { snap, roster } = load();
    const inputs = inputsFor(snap, { slot: "revit:Flow" });
    const flows = assumedFanFlows(
      snap,
      roster,
      (id) => inputs.terminals[String(id)]?.cfm.value ?? null,
      JSON.stringify(inputs.terminals),
      {},
    );
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
    // ba4fd56c (G7): unknown ERVs are absent from the assumed-flow map.
    expect(rv25).toBeUndefined();
    expect(rv7).toBeUndefined();
    const sheet = buildSheet({
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids: {},
      inputs: inputsFor(snap, { slot: "revit:Flow" }),
    });
    expect(
      sheet.notes.some((n) => n.kind === "assumed-flow" && n.text.startsWith(`fan ${RV25}:2`)),
    ).toBe(false);
    expect(sheet.totals.requiredEspAssumedInWg).toBeNull();
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
    expect(sheet.notes.some((i) => /diverging-table/.test(i.text))).toBe(false);

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
        snap.nodes
          .filter((node) => node.family === family)
          .map((node) => input.inputs.components[String(node.id)]?.drop),
      ).toEqual(
        Array.from({ length: n }, () => ({
          value: null,
          source: "none",
          units: "in-wg",
          status: "missing",
          version: null,
          ref: `family placeholder 1 on ${n}`,
        })),
      );

    // A demoted family no rule prices raises unknown-drop with the family default in its note.
    const renamed = {
      ...snap,
      nodes: snap.nodes.map((n) =>
        n.family === "Damper_Volume_Round" ? { ...n, family: "Volume Widget" } : n,
      ),
    };
    const widget = buildSheet({
      ...input,
      snapshot: renamed,
      inputs: inputsFor(renamed, { slot: "revit:Flow" }),
    });
    expect(widget.blockers).toContainEqual(
      expect.objectContaining({
        id: "unknown-drop:13493795",
        detail: "accessory has no drop (family placeholder 1 on 252; type the real drop)",
      }),
    );
  },
  240_000,
);
