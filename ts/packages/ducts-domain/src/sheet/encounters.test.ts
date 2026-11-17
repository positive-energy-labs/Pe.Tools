import { expect, it } from "vite-plus/test";
import {
  ENCOUNTERS,
  backflowId,
  claimOf,
  encountersOf,
  hostStatic,
  type ClaimFacts,
  type HostCalc,
} from "./encounters.ts";
import { mergeCoverage } from "../system-reads.ts";
import { nodeOf } from "../test-snapshot.ts";
import type { DuctSnapshot } from "../types.ts";
import { coverageOf, wholeCoverage } from "./coverage.ts";
import { TEST_COVERAGE, TEST_WALK } from "./test-inputs.ts";
import type { Leg, SheetPath } from "./types.ts";

const leg = (id: string, elementId: number, lossInWg: number | null, out = 1): Leg => ({
  id,
  elementId,
  kind: "duct",
  outConnector: out,
  flowCfm: 100,
  flowSource: "test",
  velocityFpm: 500,
  lossInWg,
  lossSource: { kind: "friction", ref: "" },
  equivalentFt: null,
  evidence: { kind: "unpriced", issueId: "" },
});
const path = (
  side: SheetPath["side"],
  legIds: string[],
  knownInWg: number,
  end: Partial<SheetPath["end"]> = {},
): SheetPath => ({
  side,
  legIds,
  knownInWg,
  blockerIds: [],
  end: { kind: "terminal", elementId: 90, ...end },
});
const SELF = { unitId: 300, portIndex: 0 };
const HOST = { unitId: 200, portIndex: 0 };
// This fan: duct 30 to a tie-in on duct 20 (the host's trunk), and a return run through duct 32.
const legs = { a: leg("a", 30, 0.1), tie: leg("tie", 20, 0.05, 2), r: leg("r", 32, 0.2) };
const tieIn = path("supply", ["a", "tie"], 0.15, {
  kind: "sibling-fan",
  elementId: 200,
  fan: HOST,
  reached: "discharge",
});
const paths = [tieIn, path("supply", ["a"], 0.1), path("return", ["r"], 0.2)];
const facts = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  basis: "b",
  paths,
  legs,
  blockingIds: [],
  coverage: TEST_COVERAGE,
  gaps: [],
  met: encountersOf(SELF, paths, legs),
  allowanceInWg: { supply: 0.01, return: 0.02 },
  ...over,
});
// The host: fan 200 -> duct 10 (0.3) -> duct 20 (0.4, the tie-in) -> terminal.
const hostLegs = { h1: leg("h1", 10, 0.3), h2: leg("h2", 20, 0.4) };
const host = (over: Partial<HostCalc> = {}): HostCalc => ({
  network: "n",
  claim: { kind: "complete", basis: "hb", requiredEspInWg: 1, coverage: [], blockingIds: [] },
  paths: [path("supply", ["h1", "h2"], 0.7)],
  legs: hostLegs,
  ...over,
});

it("ENCOUNTERS keeps verdict and static apart: only a supply meeting a discharge is backflow with host static", () => {
  expect(ENCOUNTERS["supply>discharge"]).toEqual({ verdict: "unruled", static: "host-calc", backflow: true });
  for (const key of ["supply>inlet", "return>inlet", "return>discharge"] as const)
    expect(ENCOUNTERS[key]).toEqual({ verdict: "accepted", static: "none", backflow: false });
  expect(ENCOUNTERS["return>unknown"].verdict).toBe("unruled");
});

it("an encounter sits at the path's last leg; a ruling changes its verdict, never its static", () => {
  const [met] = encountersOf(SELF, paths, legs);
  expect(met!.encounter).toEqual({
    fan: SELF,
    host: HOST,
    elementId: 20,
    connector: 2,
    side: "supply",
    verdict: "unruled",
    static: { kind: "none" },
  });
  const ruled = encountersOf(SELF, paths, legs, [
    { at: { elementId: 20, connector: 2 }, verdict: "accepted", by: "human", ref: "work:test" },
  ]);
  expect(ruled[0]!.encounter).toMatchObject({ verdict: "accepted", static: { kind: "none" } });
});

it("an unruled encounter never reads complete: backflow is a boundary with its error id", () => {
  const claim = claimOf(facts());
  expect(claim).toMatchObject({ kind: "to-boundary", coverage: [] });
  expect(claim.blockingIds).toEqual([backflowId({ elementId: 20, connector: 2 })]);
  // Unexpected missing data beside it is incomplete, not a boundary.
  expect(claimOf(facts({ blockingIds: ["no-flow:90"] })).kind).toBe("incomplete");
});

it("H5: the host static is its calc's cumulative loss to the tie-in, and only a complete calc at this basis answers", () => {
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
  expect(hostStatic(host(), e, "n")).toEqual({ inWg: 0.3, basis: "hb" });
  const gap = (h: Parameters<typeof hostStatic>[0]) => hostStatic(h, e, "n");
  expect(gap("absent")).toMatchObject({ kind: "host-calc", elementId: 20 });
  expect(gap("cycle")).toMatchObject({ kind: "cycle" });
  expect(gap(host({ network: "older" }))).toMatchObject({ kind: "host-calc", ref: expect.stringContaining("stale") });
  expect(
    gap(host({ claim: { kind: "incomplete", basis: "hb", knownInWg: 0, coverage: [], blockingIds: ["x"] } })),
  ).toMatchObject({ kind: "host-calc", ref: expect.stringContaining("incomplete") });
  expect(gap(host({ paths: [path("supply", ["h1"], 0.3)] }))).toMatchObject({ kind: "host-calc" });
});

it("a positive tie-in static is added once, on its own path; an accepted tie-in with no host number is a gap", () => {
  const accepted = () =>
    encountersOf(SELF, paths, legs, [{ at: { elementId: 20, connector: 2 }, verdict: "accepted", by: "human", ref: "work:test" }]);
  // Accepted, but no host calc answered: never complete.
  expect(claimOf(facts({ met: accepted() }))).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "host-calc", elementId: 20 }],
  });
  const met = accepted();
  met[0]!.encounter.static = { kind: "host-calc", basis: "hb", inWg: 0.3, source: "host" };
  // Worst supply is the tie-in path 0.15 + 0.3 once; return 0.2; allowances 0.03.
  expect(claimOf(facts({ met }))).toEqual({
    kind: "complete",
    basis: "b",
    requiredEspInWg: 0.68,
    coverage: [],
    blockingIds: [],
  });
  const refused = encountersOf(SELF, paths, legs, [
    { at: { elementId: 20, connector: 2 }, verdict: "refused", by: "human", ref: "work:test" },
  ]);
  expect(claimOf(facts({ met: refused })).kind).toBe("incomplete");
});

it("a return tie-in takes no credit and adds nothing", () => {
  const onReturn = [
    path("supply", ["a"], 0.1),
    path("return", ["r"], 0.2, { kind: "sibling-fan", elementId: 200, fan: HOST, reached: "inlet" }),
  ];
  const met = encountersOf(SELF, onReturn, legs);
  expect(met[0]!.encounter).toMatchObject({ side: "return", verdict: "accepted", static: { kind: "none" } });
  expect(claimOf(facts({ paths: onReturn, met }))).toMatchObject({ kind: "complete", requiredEspInWg: 0.33 });
});

it("an unpriced leg with no blocker is a pricing gap, and a side with no path is never complete", () => {
  const holed = { ...legs, a: leg("a", 30, null) };
  const own = [path("supply", ["a"], 0), path("return", ["r"], 0.2)];
  expect(claimOf(facts({ paths: own, legs: holed, met: [] }))).toMatchObject({
    kind: "incomplete",
    coverage: [{ kind: "pricing", elementId: 30 }],
    blockingIds: [],
  });
  expect(claimOf(facts({ paths: [own[1]!], met: [] })).coverage).toEqual([
    { kind: "pricing", elementId: null, ref: "no supply path" },
  ]);
});

// RULES 2026-11-16 18:00 (P-028, P-033(a), P-035): one table over every way coverage can fail.
it("coverage: every way a read can fail withholds `complete`, and only a fully read snapshot grants it", () => {
  // This fan walked element 30; element 99 is in the read and belongs to another fan; 12345 is in no read.
  const held = { nodes: [nodeOf(30, "fitting"), nodeOf(99, "fitting")], segments: [] };
  const walked = new Set([30]);
  const reach = { complete: true, unreadPeers: [] };
  const peer = (elementId: number, connector = 1) => ({ elementId, connector });
  const own = [path("supply", ["a"], 0.1), path("return", ["r"], 0.2)];
  const claim = (evidence: Pick<DuctSnapshot, "walk" | "reach">) => {
    const coverage = coverageOf({ ...held, ...evidence }, walked);
    return { coverage, claim: claimOf(facts({ paths: own, met: [], coverage })) };
  };
  const failures: Record<string, Pick<DuctSnapshot, "walk" | "reach">> = {
    "absent walk and reach": {},
    "null walk and reach": { walk: null, reach: null },
    "a merged part with no evidence, beside a walk": mergeCoverage([{ walk: TEST_WALK }, {}]),
    "a merged part with no evidence, beside a reach": mergeCoverage([{ walk: null, reach: null }, { reach }]),
    "a walk's unread peer on a walked element": { walk: { ...TEST_WALK, unreadPeers: [peer(30)] } },
    "a reach's unread peer on a walked element": { reach: { complete: false, unreadPeers: [peer(30)] } },
    "a failed system seed read (connector -1)": { walk: TEST_WALK, reach: { complete: false, unreadPeers: [peer(555, -1)] } },
    "a failed system seed read on a reach that calls itself complete": { reach: { complete: true, unreadPeers: [peer(555, -1)] } },
    "an incomplete reach that names no peer": { walk: TEST_WALK, reach: { complete: false, unreadPeers: [] } },
    "a walk from before the native read listed unread peers": { walk: { ...TEST_WALK, unreadPeers: undefined } as never },
    "a truncated walk": { walk: { ...TEST_WALK, truncated: true } },
    "a truncated walk whose only unread peer is another fan's": { walk: { ...TEST_WALK, truncated: true, unreadPeers: [peer(99)] } },
    "an unread peer on an element no read holds": { reach: { complete: false, unreadPeers: [peer(12345)] } },
    "a merge whose second walk was truncated": mergeCoverage([{ walk: TEST_WALK }, { walk: { ...TEST_WALK, truncated: true } }]),
    "a merge whose first reach lost a peer": mergeCoverage([{ reach: { complete: false, unreadPeers: [peer(30)] } }, { reach }]),
  };
  for (const [name, evidence] of Object.entries(failures)) {
    const got = claim(evidence);
    expect(wholeCoverage(got.coverage), name).toBeNull();
    expect(got.claim.kind, name).toBe("incomplete");
    expect(got.claim.coverage.length, name).toBeGreaterThan(0);
  }
  const wholes: Record<string, Pick<DuctSnapshot, "walk" | "reach">> = {
    "a walk that read every peer": { walk: TEST_WALK },
    "a walk and a reach that read every peer": { walk: TEST_WALK, reach },
    "a reach incomplete only by another fan's peer": { reach: { complete: false, unreadPeers: [peer(99)] } },
  };
  for (const [name, evidence] of Object.entries(wholes)) expect(claim(evidence).claim.kind, name).toBe("complete");
});
