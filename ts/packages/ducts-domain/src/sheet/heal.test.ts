import { fittingPricingSchema } from "@pe/agent-contracts";
import { inputsFor } from "./test-inputs.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import type { DuctSnapshot } from "../types.ts";
import { suggestRoster, type FanPort } from "../roster.ts";
import { friction, roundSection } from "../loss-physics.ts";
import { buildSheet } from "./build.ts";
import { grids } from "./tables.fixture.ts";
import { withHealth } from "./health.fixture.ts";
import { graphOf, walkFrom } from "./walk.ts";
import { PROPOSED_KEY } from "./inputs.ts";
import { assumedFanFlows } from "./assumed-flow.ts";

type Port = DuctSnapshot["nodes"][number]["connectors"][number];
const port = (
  index: number,
  point: number[],
  facing: number[],
  to: [number, number] | null,
  cls = "SupplyAir",
): Port =>
  ({
    index,
    point,
    facing,
    kind: "end",
    direction: "bidirectional",
    shape: "round",
    diameterIn: 8,
    classification: cls,
    connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
  }) as Port;
const node = (id: number, kind: string, connectors: Port[], flow?: number) => ({
  id,
  kind,
  facts: flow == null ? [] : [{ key: "flow", value: flow }],
  connectors,
});
const duct = (id: number, a: number[], b: number[], connectors: Port[]) => ({
  id,
  shape: "round",
  diameterIn: 8,
  polyline: [a, b],
  lengthFt: Math.hypot(...a.map((v, i) => v - b[i]!)),
  roughness: { valueFt: 0.0003 },
  connectors,
});
const roster = [
  { unitId: 100, portIndex: 0, inletPortIndex: 1, side: "supply", tag: "F", kind: "air-handler" },
] as FanPort[];
function fixture() {
  return {
    document: { title: "heals", readAt: "fixed" },
    slots: { terminalFlow: "named" },
    nodes: [
      node(100, "equipment", [
        port(0, [0, 0, 0], [1, 0, 0], [1, 0]),
        port(1, [0, 0, 0], [-1, 0, 0], [102, 0], "ReturnAir"),
      ]),
      node(102, "terminal", [port(0, [0, 0, 0], [1, 0, 0], [100, 1], "ReturnAir")], 100),
      node(200, "terminal", [port(0, [8, 0, 0], [-1, 0, 0], [2, 1])], 100),
    ],
    segments: [
      duct(
        1,
        [0, 0, 0],
        [4, 0, 0],
        [port(0, [0, 0, 0], [-1, 0, 0], [100, 0]), port(1, [4, 0, 0], [1, 0, 0], null)],
      ),
      duct(
        2,
        [5, 0, 0],
        [8, 0, 0],
        [port(0, [5, 0, 0], [-1, 0, 0], null), port(1, [8, 0, 0], [1, 0, 0], [200, 0])],
      ),
    ],
  } as unknown as DuctSnapshot;
}

it("extends a join on the assumed walk, charges gap friction, and only an accepted ruling completes known ESP", () => {
  const snapshot = fixture();
  const sheetSnapshot1 = withHealth(snapshot);
  const input = {
    snapshot: sheetSnapshot1, inputs: inputsFor(sheetSnapshot1),
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    assumeServedFlow: false,
  };
  const sheet = buildSheet(input);
  expect(sheet.totals.requiredEspInWg).toBeNull();
  const expected = friction(roundSection(8), 100, 8, 0.0003).dp + 0.06;
  expect(sheet.totals.requiredEspAssumedInWg).toBeCloseTo(expected, 6);
  const proposal = sheet.blockers.find((b) => b.proposal)!.proposal!;
  expect(proposal).toMatchObject({
    kind: "join",
    pair: ["1:1", "2:0"],
    fittingChange: false,
    gapIn: 12,
  });
  expect(proposal.assumedLegs[0]!.lossInWg).toBeCloseTo(
    friction(roundSection(8), 100, 1, 0.0003).dp,
    8,
  );
  expect(snapshot.segments[0]!.connectors[1]!.connectedTo).toBeNull();
  const accepted = buildSheet({ ...input, inputs: inputsFor(input.snapshot, { rulings: [{ pair: proposal.pair, verdict: "accept" }] }) });
  expect(accepted.blockers).toEqual([]);
  expect(accepted.totals.requiredEspInWg).toBeCloseTo(expected, 6);
  expect(accepted.basis).not.toBe(sheet.basis);
  const rejected = buildSheet({ ...input, inputs: inputsFor(input.snapshot, { rulings: [{ pair: proposal.pair, verdict: "reject" }] }) });
  expect(rejected.totals.requiredEspAssumedInWg).toBeNull();
  expect(rejected.blockers.some((b) => b.proposal?.pair.join() === proposal.pair.join())).toBe(
    false,
  );
});

it("proposes a duct-body tap and walks on through the landing duct both ways (R-Q4); the proposed tap is a fitting priced per path", () => {
  const snapshot = fixture();
  snapshot.segments[1] = duct(
    2,
    [5, -5, 0],
    [5, 5, 0],
    [port(0, [5, -5, 0], [0, -1, 0], [300, 0]), port(1, [5, 5, 0], [0, 1, 0], [400, 0])],
  ) as unknown as DuctSnapshot["segments"][number];
  snapshot.nodes.push(
    node(
      300,
      "terminal",
      [port(0, [5, -5, 0], [0, 1, 0], [2, 0])],
      50,
    ) as unknown as DuctSnapshot["nodes"][number],
    node(
      400,
      "terminal",
      [port(0, [5, 5, 0], [0, -1, 0], [2, 1])],
      50,
    ) as unknown as DuctSnapshot["nodes"][number],
  );
  const sheetSnapshot2 = withHealth(snapshot);
  const input = {
    snapshot: sheetSnapshot2,
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    inputs: inputsFor(sheetSnapshot2, { endCfm: { 300: 50, 400: 50 } }),
  };
  const sheet = buildSheet(input);
  const proposal = sheet.blockers.find((b) => b.proposal)!.proposal!;
  expect(proposal.kind).toBe("tap");
  expect(proposal.to.connector).toBeNull();
  expect(proposal.gapIn).toBeCloseTo(8);
  // The landing duct is this fan's own (unowned) network: a split, not a Q4 merge.
  expect(sheet.assumed.paths.some((p) => p.end.kind === "joins-other-fan")).toBe(false);
  expect(
    sheet.assumed.paths
      .filter((p) => p.side === "supply")
      .map((p) => p.end.elementId)
      .sort(),
  ).toEqual([300, 400]);
  // Entered at the landing point (no connector): 5 ft each way at each terminal's 50 cfm.
  for (const id of ["2:>0", "2:>1"]) {
    expect(sheet.assumed.legs[id]).toMatchObject({ flowCfm: 50 });
    expect(sheet.assumed.legs[id]!.lossInWg).toBeCloseTo(
      friction(roundSection(8), 50, 5, 0.0003).dp,
      8,
    );
  }
  // kaitpw 2026-10-29: the proposed tap is a fitting, never one combined drop on the source duct.
  // With no tables loaded each branch path is not priced, and the blocker names its census row,
  // which offers the takeoff rules. Nothing asks for an element/fitting combined drop.
  const all = [...sheet.blockers, ...sheet.assumed.blockers];
  expect(all.some((b) => b.kind === "unknown-drop")).toBe(false);
  const blocked = all.find((b) => b.fitting?.startsWith("proposed:"))!;
  expect(blocked.kind).toBe("not-priced");
  const row = sheet.fittings.find((f) => f.key === blocked.fitting)!;
  expect(row).toMatchObject({ family: "proposed tap", proposed: { kind: "tap", path: "branch" } });
  expect(row.candidates.map((c) => c.rule)).toContain("tap-std");
  expect(sheet.totals.requiredEspAssumedInWg).toBeNull();
  // A typed drop is per path: toward 300 and toward 400 differ, and each path carries only its own.
  const priced = buildSheet({
    ...input,
    inputs: inputsFor(input.snapshot, {
      endCfm: { 300: 50, 400: 50 },
      fittingDrops: { [PROPOSED_KEY(proposal.pair, 300)]: 0.02, [PROPOSED_KEY(proposal.pair, 400)]: 0.05 },
    }),
  });
  const known = (end: number) =>
    priced.assumed.paths.find((p) => p.side === "supply" && p.end.elementId === end)!.knownInWg;
  expect(known(400) - known(300)).toBeCloseTo(0.03, 9);
  // The source duct keeps its own friction; the worst path adds only its own path's typed drop.
  expect(priced.totals.requiredEspAssumedInWg).toBeCloseTo(
    0.06 +
      friction(roundSection(8), 100, 4, 0.0003).dp +
      friction(roundSection(8), 100, 8 / 12, 0.0003).dp +
      0.05 +
      friction(roundSection(8), 50, 5, 0.0003).dp,
    6,
  );
  expect(priced.totals.requiredEspInWg).toBeNull();
  const accepted = buildSheet({
    ...input,
    inputs: inputsFor(input.snapshot, {
      endCfm: { 300: 50, 400: 50 },
      fittingDrops: { [PROPOSED_KEY(proposal.pair, 300)]: 0.02, [PROPOSED_KEY(proposal.pair, 400)]: 0.05 },
      rulings: [{ pair: proposal.pair, verdict: "accept" }],
    }),
  });
  expect(accepted.totals.requiredEspInWg).not.toBeNull();
  // With the tables, each path is priced by its auto-matched takeoff table, at its own share: the
  // collar's 100 cfm divides both ways, so each path reads the diverging table at Qb/Qc 0.5.
  if (grids["SD5-9"]) {
    const tabled = buildSheet({ ...input, grids, inputs: inputsFor(input.snapshot, { endCfm: { 300: 50, 400: 50 } }) });
    const rows = tabled.fittings.filter((f) => f.proposed?.kind === "tap");
    expect(rows.map((f) => [f.proposed!.toward, f.rule, f.table, f.ruleSource]).sort()).toEqual([
      [300, "tap-std", "SD5-9", "matched"],
      [400, "tap-std", "SD5-9", "matched"],
    ]);
    expect(rows.every((f) => f.lossInWg != null && f.lossInWg > 0)).toBe(true);
  }
});

it("occupied mouths require a risky tee, preserve both branches, and cross-air-type proposals are refused unless the person accepts that pair", () => {
  const snapshot = fixture();
  snapshot.segments[1]!.connectors[0]!.connectedTo = { elementId: 900, connector: 0 };
  // Any occupant but an end cap needs a tee; a capped mouth is the C3 transition (next test).
  snapshot.nodes.push(
    node(900, "fitting", [
      port(0, [5, 0, 0], [1, 0, 0], [2, 0]),
    ]) as unknown as DuctSnapshot["nodes"][number],
  );
  const sheetSnapshot3 = withHealth(snapshot);
  const input = {
    snapshot: sheetSnapshot3, inputs: inputsFor(sheetSnapshot3),
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
  };
  const sheet = buildSheet(input);
  const p = sheet.blockers.find((b) => b.proposal)!.proposal!;
  expect(p).toMatchObject({
    kind: "tee",
    fittingChange: true,
    risk: expect.stringContaining("Riskiest"),
  });
  expect(sheet.assumed.paths.some((p) => p.end.elementId === 200)).toBe(true);
  // The tee is a fitting on its table (none loaded here), not a combined drop on the open end.
  expect(sheet.assumed.blockers.some((b) => b.kind === "unknown-drop")).toBe(false);
  expect(
    sheet.assumed.blockers.some((b) => b.kind === "not-priced" && b.fitting?.startsWith("proposed:")),
  ).toBe(true);
  for (const c of snapshot.segments[1]!.connectors) c.classification = "ReturnAir";
  // Unruled, a crossing is never proposed, even on the assumed walk (W0-A rule 2 holds).
  const silent = walkFrom(graphOf(withHealth(snapshot)), snapshot.nodes[0]!, 0, {
    roster,
    assumeHeals: true,
  });
  expect(silent.heals).toEqual([]);
  expect([...silent.blockers.values()].some((b) => b.proposal)).toBe(false);
  // Departure (2026-10-28, FC-23 close): this test once held "refused even when accepted". The
  // kernel's `applyConnectorPairRulings` has always joined an accepted pair across classes, and
  // the page's "accept join" verb writes exactly that pair; on Chadds three ReturnAir plenums
  // end 0.01 in from SupplyAir grilles, which nothing else can close. The boundary that holds:
  // only a person's accept of that exact pair joins; nothing crosses silently.
  const walk = walkFrom(graphOf(withHealth(snapshot)), snapshot.nodes[0]!, 0, {
    roster,
    assumeHeals: true,
    rulings: [{ pair: p.pair, verdict: "accept" }],
  });
  expect(walk.heals.map((h) => h.proposal.pair)).toEqual([p.pair]);
  expect([...walk.blockers.values()].some((b) => b.proposal)).toBe(false);
});

it("a capped mouth 2.6 in from an open end proposes replacing the cap with a transition, priced on one straight path by a transition table, never a tee (C3)", () => {
  // MUAS-1's intake 14122436:1 sits 2.63 in from louver plenum 14106988:1, capped by 14107111:
  // here an 8 in round end 2.6 in from a 30x30 duct whose facing connector carries cap 900.
  const snapshot = fixture();
  const gap = 2.6 / 12;
  const rect = (p: Port) => Object.assign(p, { shape: "rectangular", diameterIn: undefined, widthIn: 30, heightIn: 30 });
  snapshot.segments[1] = {
    ...duct(2, [4 + gap, 0, 0], [8, 0, 0], [
      rect(port(0, [4 + gap, 0, 0], [-1, 0, 0], [900, 0])),
      rect(port(1, [8, 0, 0], [1, 0, 0], [200, 0])),
    ]),
    shape: "rectangular",
    diameterIn: undefined,
    widthIn: 30,
    heightIn: 30,
  } as unknown as DuctSnapshot["segments"][number];
  snapshot.nodes.push(
    node(900, "cap", [
      rect(port(0, [4 + gap, 0, 0], [1, 0, 0], [2, 0])),
    ]) as unknown as DuctSnapshot["nodes"][number],
  );
  const s = withHealth(snapshot);
  const input = { snapshot: s, inputs: inputsFor(s), roster, fan: { unitId: 100, portIndex: 0 }, grids };
  const sheet = buildSheet(input);
  const proposals = sheet.blockers.flatMap((b) => (b.proposal ? [b.proposal] : []));
  expect(proposals.some((p) => p.kind === "tee")).toBe(false);
  const p = proposals[0]!;
  expect(p).toMatchObject({
    kind: "transition",
    pair: ["1:1", "2:0"],
    fittingChange: true,
    replaces: { elementId: 900 },
    risk: "Remove end cap 900 and fit a transition; fitting loss required",
  });
  expect(p.gapIn).toBeCloseTo(2.6, 3);
  // One straight path, keyed `>straight`, on the transition family's table: 8 in round into 30x30
  // on the supply is SR4-3 (round to rectangular), never SD5-9's takeoff.
  const key = PROPOSED_KEY(p.pair, "straight");
  const rows = sheet.fittings.filter((f) => f.proposed);
  expect(rows.map((f) => f.key)).toEqual([key]);
  expect(rows[0]).toMatchObject({
    proposed: { kind: "transition", path: "straight", toward: null },
    rule: "trx-grille",
    table: "SR4-3",
    ruleSource: "matched",
    unpriced: null,
  });
  expect(rows[0]!.lossInWg).toBeGreaterThan(0);
  // fix6 defect 1 (live 500, `fittings[35].elementId`): a proposed fitting is no element; its
  // identity is its key and pair, never a sentinel id, and the census passes the route's schema.
  expect(rows[0]!.elementId).toBeNull();
  expect(fittingPricingSchema.array().safeParse(sheet.fittings).error?.issues ?? []).toEqual([]);
  const path = sheet.assumed.paths.find((x) => x.end.elementId === 200)!;
  expect(path.complete).toBe(true);
  const fittingLegs = path.legIds.filter((id) => id.startsWith("heal:") && id.includes(":fitting>"));
  expect(fittingLegs).toEqual([`heal:1:1|2:0:fitting>2`]);
  expect(sheet.assumed.legs[fittingLegs[0]!]!.lossSource.ref).toMatch(/^trx-grille SR4-3 /);
  // A typed drop on that one path stands in for the table.
  const typed = buildSheet({ ...input, inputs: inputsFor(s, { fittingDrops: { [key]: 0.05 } }) });
  expect(typed.fittings.find((f) => f.key === key)).toMatchObject({ typed: 0.05, lossInWg: 0.05 });
});

it("derived served-terminal flow supplies assumed ESP, preserves missing designer flow on known, and discloses connector fallback", () => {
  const snapshot = fixture();
  snapshot.segments = [
    duct(
      1,
      [0, 0, 0],
      [4, 0, 0],
      [port(0, [0, 0, 0], [-1, 0, 0], [100, 0]), port(1, [4, 0, 0], [1, 0, 0], [400, 1])],
    ),
  ] as unknown as DuctSnapshot["segments"];
  snapshot.nodes.push(
    node(400, "equipment", [
      port(1, [4, 0, 0], [-1, 0, 0], [1, 1]),
      port(0, [8, 0, 0], [1, 0, 0], [200, 0]),
    ]) as unknown as DuctSnapshot["nodes"][number],
  );
  snapshot.nodes[2]!.connectors[0]!.connectedTo = { elementId: 400, connector: 0 };
  snapshot.nodes[2]!.facts = [
    { key: "flow", value: 200, unit: "cfm", provenance: "designer-stated" },
  ];
  const sheetSnapshot4 = withHealth(snapshot);
  const input = {
    snapshot: sheetSnapshot4, inputs: inputsFor(sheetSnapshot4),
    roster: [...roster, { ...roster[0]!, unitId: 400 }],
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
  };
  const without = buildSheet({ ...input, assumeServedFlow: false });
  const withFlow = buildSheet(input);
  expect(without.totals.requiredEspAssumedInWg).toBeNull();
  expect(withFlow.totals.requiredEspAssumedInWg).not.toBeNull();
  expect(withFlow.totals.requiredEspInWg).toBeNull();
  // One stream passes through the fan: this side carries its paired return's 100 cfm. The receiving
  // fan's 200 cfm mixes other air downstream; borrowing it put 3164 cfm through RV-11's 4 in duct.
  expect(withFlow.assumed.legs["1:0>1"]!.flowCfm).toBe(100);
  expect(withFlow.blockers.some((b) => b.kind === "no-flow")).toBe(true);
  expect(
    Object.values(withFlow.assumed.legs).some((l) =>
      l.flowSource?.includes("derived from served terminals (assumed)"),
    ),
  ).toBe(true);
  expect(
    withFlow.notes.some((i) => i.text.includes("derived from served terminals (assumed)")),
  ).toBe(true);
  const fallbackSnapshot = structuredClone(snapshot);
  for (const n of fallbackSnapshot.nodes) n.facts = [];
  fallbackSnapshot.nodes[0]!.connectors[0]!.flowCfm = 90;
  const fallback = buildSheet({ ...input, snapshot: fallbackSnapshot, inputs: inputsFor(fallbackSnapshot) });
  expect(fallback.notes.some((i) => i.text.includes("unit connector flowCfm (assumed)"))).toBe(
    true,
  );
});

it("an accepted pair takes priority over a nearer automatic join", () => {
  const snapshot = fixture();
  snapshot.nodes.push(
    node(
      250,
      "terminal",
      [port(0, [4.1, 0, 0], [-1, 0, 0], null)],
      50,
    ) as unknown as DuctSnapshot["nodes"][number],
  );
  const sheetSnapshot5 = withHealth(snapshot);
  const input = {
    snapshot: sheetSnapshot5, inputs: inputsFor(sheetSnapshot5),
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
  };
  const ordinary = buildSheet(input);
  expect(ordinary.paths.some((p) => p.end.elementId === 250)).toBe(true);
  const accepted = buildSheet({ ...input, inputs: inputsFor(input.snapshot, { rulings: [{ pair: ["1:1", "2:0"], verdict: "accept" }] }) });
  expect(accepted.paths.some((p) => p.end.elementId === 200)).toBe(true);
  expect(accepted.paths.some((p) => p.end.elementId === 250)).toBe(false);
});

it("a proposed join's turn at the fan root is priced on its path, not by the unit's own drop", () => {
  const snapshot = fixture();
  snapshot.segments = [];
  snapshot.nodes[0]!.connectors[0]!.connectedTo = null;
  snapshot.nodes[0]!.connectors[0]!.facing = [0, 1, 0];
  snapshot.nodes[2]!.connectors[0]!.connectedTo = null;
  snapshot.nodes[2]!.connectors[0]!.point = [1, 0, 0];
  const sheetSnapshot6 = withHealth(snapshot);
  const sheet = buildSheet({
    snapshot: sheetSnapshot6,
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    inputs: inputsFor(sheetSnapshot6, { drops: { 100: 0.02 } }),
  });
  const proposal = sheet.blockers.find((b) => b.proposal)!.proposal!;
  expect(proposal.fittingChange).toBe(true);
  // The unit's own typed drop is the unit's, never the proposed fitting's (2026-10-29).
  expect(sheet.totals.requiredEspAssumedInWg).toBeNull();
  const blocked = sheet.assumed.blockers.find((b) => b.fitting?.startsWith("proposed:"))!;
  expect(blocked.fitting).toBe(PROPOSED_KEY(proposal.pair, 200));
  expect(sheet.fittings.find((f) => f.key === blocked.fitting)).toMatchObject({
    proposed: { kind: "join", toward: 200 },
    candidates: [],
  });
  const typed = buildSheet({
    snapshot: sheetSnapshot6,
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    inputs: inputsFor(sheetSnapshot6, { fittingDrops: { [PROPOSED_KEY(proposal.pair, 200)]: 0.02 } }),
  });
  expect(typed.totals.requiredEspAssumedInWg).toBeCloseTo(
    0.08 + friction(roundSection(8), 100, 1, 0.0003).dp,
    6,
  );
  expect(typed.totals.requiredEspInWg).toBeNull();
});

const retained =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
it.skipIf(!existsSync(retained))(
  "retained Chadds: compare assumptions with and without served-terminal derivation",
  () => {
    const snapshot = (JSON.parse(readFileSync(retained, "utf8")) as { result: DuctSnapshot })
      .result;
    const r = suggestRoster(snapshot),
      roster = [...r.fans, ...r.suggestions];
    const results = roster.map((fan) => {
      const input = { snapshot, roster, fan, inputs: inputsFor(snapshot, { slot: "revit:Flow" }), grids };
      const withFlow = buildSheet(input),
        without = buildSheet({ ...input, assumeServedFlow: false });
      return {
        unitId: fan.unitId,
        portIndex: fan.portIndex,
        mark: fan.tag,
        withFlow: withFlow.totals,
        without: without.totals,
        proposals: withFlow.blockers.filter((b) => b.proposal).map((b) => b.proposal),
        withoutBlockers: without.assumed.blockers.map((b) => ({
          kind: b.kind,
          elementId: b.elementId,
        })),
        derivedInputs: withFlow.notes.filter((i) => i.kind === "assumed-flow"),
        assumedBlockers: withFlow.assumed.blockers.map((b) => ({
          kind: b.kind,
          elementId: b.elementId,
          detail: b.detail,
        })),
      };
    });
    const muas = results.find((r) => r.unitId === 14577391)!;
    expect(muas.proposals.length).toBeGreaterThan(0);
    expect(muas.withFlow.requiredEspInWg).toBeNull();
    if (process.env.HEAL_OUT)
      writeFileSync(
        process.env.HEAL_OUT,
        JSON.stringify({
          tableSource: "same retained offline tables as census.tmp.test.ts",
          results,
        }),
      );
  },
  300000,
);

it("assumed flow borrows a receiving unit's flow only through its intake, never from a co-source on a shared trunk", () => {
  const units = (bDirection: "in" | "out", aKind: FanPort["kind"] = "muas") => {
    const dir = (p: Port, d: string) => ({ ...p, direction: d }) as Port;
    const snapshot = {
      document: { title: "co-source", readAt: "fixed" },
      slots: { terminalFlow: "named" },
      nodes: [
        node(300, "equipment", [
          dir(port(0, [0, 0, 0], [1, 0, 0], [10, 0]), "out"),
          dir(port(1, [0, 0, 0], [-1, 0, 0], null), "in"),
        ]),
        node(400, "equipment", [
          dir(port(0, [4, 0, 0], [-1, 0, 0], [10, 1]), bDirection),
          dir(port(1, [4, 0, 0], [1, 0, 0], [402, 0], "ReturnAir"), "in"),
        ]),
        node(402, "terminal", [port(0, [4, 0, 0], [-1, 0, 0], [400, 1], "ReturnAir")], 150),
      ],
      segments: [
        duct(
          10,
          [0, 0, 0],
          [4, 0, 0],
          [port(0, [0, 0, 0], [-1, 0, 0], [300, 0]), port(1, [4, 0, 0], [1, 0, 0], [400, 0])],
        ),
      ],
    } as unknown as DuctSnapshot;
    const units = [
      { unitId: 300, portIndex: 0, inletPortIndex: 1, side: "supply", tag: "A", kind: aKind },
      {
        unitId: 400,
        portIndex: 0,
        inletPortIndex: 1,
        side: "supply",
        tag: "B",
        kind: "air-handler",
      },
    ] as FanPort[];
    const inputs = inputsFor(snapshot);
    return assumedFanFlows(snapshot, units, (id) => inputs.terminals[String(id)]?.cfm.value ?? null, JSON.stringify(inputs.terminals), {});
  };
  // B's port is its intake: A's discharge is B's whole intake stream, so A borrows B's 150 cfm.
  expect(units("in").get("300:0")?.cfm).toBe(150);
  // B's port is a discharge on the same trunk (Chadds RV-11/RV-23): a co-source, nothing to borrow.
  expect(units("out").get("300:0")).toBeUndefined();
  // An ERV in A's place supplies no terminal through its own discharge: unknown, with a line,
  // never B's 150 (kaitpw 2026-10-28; Chadds RV-25 and RV-7 read FC-23's sum before).
  expect(units("in", "erv").get("300:0")).toEqual({
    cfm: 0,
    source:
      "unknown (0 assumed): ERV 300:0's discharge reaches no terminal it supplies; type the unit design flow",
  });
});
