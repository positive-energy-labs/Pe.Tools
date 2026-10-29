import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import type { DuctSnapshot } from "../types.ts";
import { suggestRoster, type FanPort } from "../roster.ts";
import { friction, roundSection } from "../loss-physics.ts";
import { buildSheet } from "./build.ts";
import { grids } from "./tables.fixture.ts";
import { graphOf, walkFrom } from "./walk.ts";
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
  const input = {
    snapshot,
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
  const accepted = buildSheet({ ...input, rulings: [{ pair: proposal.pair, verdict: "accept" }] });
  expect(accepted.blockers).toEqual([]);
  expect(accepted.totals.requiredEspInWg).toBeCloseTo(expected, 6);
  expect(accepted.basis).not.toBe(sheet.basis);
  const rejected = buildSheet({ ...input, rulings: [{ pair: proposal.pair, verdict: "reject" }] });
  expect(rejected.totals.requiredEspAssumedInWg).toBeNull();
  expect(rejected.blockers.some((b) => b.proposal?.pair.join() === proposal.pair.join())).toBe(
    false,
  );
});

it("proposes a duct-body tap and walks on through the landing duct both ways (R-Q4); the unpriced fitting stays blocked until a drop is typed", () => {
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
  const input = {
    snapshot,
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    endCfm: { 300: 50, 400: 50 },
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
  expect(sheet.assumed.blockers.some((b) => b.kind === "unknown-drop")).toBe(true);
  expect(sheet.totals.requiredEspAssumedInWg).toBeNull();
  const priced = buildSheet({ ...input, drops: { 1: 0.02 } });
  expect(priced.totals.requiredEspAssumedInWg).toBeCloseTo(
    0.08 +
      friction(roundSection(8), 100, 8 / 12, 0.0003).dp +
      friction(roundSection(8), 50, 5, 0.0003).dp,
    6,
  );
  expect(priced.totals.requiredEspInWg).toBeNull();
  const accepted = buildSheet({
    ...input,
    drops: { 1: 0.02 },
    rulings: [{ pair: proposal.pair, verdict: "accept" }],
  });
  expect(accepted.totals.requiredEspInWg).not.toBeNull();
});

it("occupied mouths require a risky tee, preserve both branches, and cross-air-type proposals are refused unless the person accepts that pair", () => {
  const snapshot = fixture();
  snapshot.segments[1]!.connectors[0]!.connectedTo = { elementId: 900, connector: 0 };
  snapshot.nodes.push(
    node(900, "cap", [
      port(0, [5, 0, 0], [1, 0, 0], [2, 0]),
    ]) as unknown as DuctSnapshot["nodes"][number],
  );
  const input = { snapshot, roster, fan: { unitId: 100, portIndex: 0 }, grids: {} };
  const sheet = buildSheet(input);
  const p = sheet.blockers.find((b) => b.proposal)!.proposal!;
  expect(p).toMatchObject({
    kind: "tee",
    fittingChange: true,
    risk: expect.stringContaining("Riskiest"),
  });
  expect(sheet.assumed.paths.some((p) => p.end.elementId === 200)).toBe(true);
  expect(sheet.assumed.blockers.some((b) => b.kind === "unknown-drop")).toBe(true);
  for (const c of snapshot.segments[1]!.connectors) c.classification = "ReturnAir";
  // Unruled, a crossing is never proposed, even on the assumed walk (W0-A rule 2 holds).
  const silent = walkFrom(graphOf(snapshot), snapshot.nodes[0]!, 0, { roster, assumeHeals: true });
  expect(silent.heals).toEqual([]);
  expect([...silent.blockers.values()].some((b) => b.proposal)).toBe(false);
  // Departure (2026-10-28, FC-23 close): this test once held "refused even when accepted". The
  // kernel's `applyConnectorPairRulings` has always joined an accepted pair across classes, and
  // the page's "accept join" verb writes exactly that pair; on Chadds three ReturnAir plenums
  // end 0.01 in from SupplyAir grilles, which nothing else can close. The boundary that holds:
  // only a person's accept of that exact pair joins; nothing crosses silently.
  const walk = walkFrom(graphOf(snapshot), snapshot.nodes[0]!, 0, {
    roster,
    assumeHeals: true,
    rulings: [{ pair: p.pair, verdict: "accept" }],
  });
  expect(walk.heals.map((h) => h.proposal.pair)).toEqual([p.pair]);
  expect([...walk.blockers.values()].some((b) => b.proposal)).toBe(false);
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
  const input = {
    snapshot,
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
    withFlow.inputs.some((i) => i.source.includes("derived from served terminals (assumed)")),
  ).toBe(true);
  const fallbackSnapshot = structuredClone(snapshot);
  for (const n of fallbackSnapshot.nodes) n.facts = [];
  fallbackSnapshot.nodes[0]!.connectors[0]!.flowCfm = 90;
  const fallback = buildSheet({ ...input, snapshot: fallbackSnapshot });
  expect(fallback.inputs.some((i) => i.source.includes("unit connector flowCfm (assumed)"))).toBe(
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
  const input = { snapshot, roster, fan: { unitId: 100, portIndex: 0 }, grids: {} };
  const ordinary = buildSheet(input);
  expect(ordinary.paths.some((p) => p.end.elementId === 250)).toBe(true);
  const accepted = buildSheet({ ...input, rulings: [{ pair: ["1:1", "2:0"], verdict: "accept" }] });
  expect(accepted.paths.some((p) => p.end.elementId === 200)).toBe(true);
  expect(accepted.paths.some((p) => p.end.elementId === 250)).toBe(false);
});

it("a typed fitting drop at the fan root is charged once even though the root is not a leg", () => {
  const snapshot = fixture();
  snapshot.segments = [];
  snapshot.nodes[0]!.connectors[0]!.connectedTo = null;
  snapshot.nodes[0]!.connectors[0]!.facing = [0, 1, 0];
  snapshot.nodes[2]!.connectors[0]!.connectedTo = null;
  snapshot.nodes[2]!.connectors[0]!.point = [1, 0, 0];
  const sheet = buildSheet({
    snapshot,
    roster,
    fan: { unitId: 100, portIndex: 0 },
    grids: {},
    drops: { 100: 0.02 },
  });
  expect(sheet.blockers.find((b) => b.proposal)!.proposal!.fittingChange).toBe(true);
  expect(sheet.totals.requiredEspAssumedInWg).toBeCloseTo(
    0.08 + friction(roundSection(8), 100, 1, 0.0003).dp,
    6,
  );
  expect(sheet.totals.requiredEspInWg).toBeNull();
});

const retained =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-raw.json";
it.skipIf(!existsSync(retained))(
  "retained Chadds: compare assumptions with and without served-terminal derivation",
  () => {
    const snapshot = (JSON.parse(readFileSync(retained, "utf8")) as { result: DuctSnapshot })
      .result;
    const r = suggestRoster(snapshot),
      roster = [...r.fans, ...r.suggestions];
    const results = roster.map((fan) => {
      const input = { snapshot, roster, fan, slot: "revit:Flow", grids };
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
        derivedInputs: withFlow.inputs.filter((i) => i.name.endsWith("cfm (assumed)")),
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
    return assumedFanFlows(snapshot as never, units, "named", {});
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
