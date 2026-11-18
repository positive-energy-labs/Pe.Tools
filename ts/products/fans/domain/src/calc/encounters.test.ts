import { expect, it } from "vite-plus/test";
import { resolveValue } from "@pe/agent-contracts/work-value";
import {
  ENCOUNTERS,
  backflowId,
  claimOf,
  encountersOf,
  hostStatic,
  pricesBeyond,
  type ClaimFacts,
  type HostCalc,
} from "./encounters.ts";
import { mergeCoverage } from "@pe/ducts-domain/system-reads";
import { nodeOf } from "@pe/ducts-domain/test-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { coverageOf, wholeCoverage } from "@pe/ducts-domain/calc/coverage";
import { TEST_COVERAGE, TEST_WALK } from "@pe/ducts-domain/test-inputs";
import type { Leg, CalcPath } from "./types.ts";

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
  side: CalcPath["side"],
  legIds: string[],
  knownInWg: number,
  end: Partial<CalcPath["end"]> = {},
): CalcPath => ({
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

it("H5 clause 1: rated pressure remaining at N", () => {
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
  // Clause 1: rated 1.2 - upstream 0.3 = 0.9 (old 0.3).
  expect(hostStatic(host({ esp: { rated: resolveValue({ model: { value: 1.2, author: null, ref: "rated" } }) } }), e, "n"))
    .toMatchObject({ inWg: expect.closeTo(0.9), basis: "hb", source: "host rated ESP minus loss to tie-in" });
});

it("H5 clause 2: missing rating assumes the host is balanced", () => {
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
  // Clause 2: required 1.0 - upstream 0.3 = 0.7 (old 0.3); warning, never a coverage gap.
  expect(hostStatic(host(), e, "n")).toEqual({ inWg: 0.7, basis: "hb", source: "host required ESP minus loss to tie-in; assumes the host is balanced" });
});

it.each([
  ["invalid status", "invalid"],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["negative", -1],
] as const)("P-090: %s host rated ESP is a host-calc gap, never a number", (_name, value) => {
  const valid = resolveValue({ model: { value: 1.2, author: null, ref: "rated" } });
  if (valid.status !== "valid") throw Error("Expected a valid fixture rating");
  // Inject at hostStatic's boundary without normalizing malformed ratings through resolveValue.
  const rated = value === "invalid" ? { ...valid, status: "invalid" as const, value: null } : { ...valid, value };
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
  expect(hostStatic(host({ esp: { rated } }), e, "n")).toEqual({
    kind: "host-calc", elementId: 20, ref: "host 200:0 rated ESP is invalid",
  });
});

it("H5 clause 5: a rating below required ESP is backflow/deadhead", () => {
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
  // Clause 5: rated 0.8 < required 1.0, so no pressure can authorize a write.
  expect(hostStatic(host({ esp: { rated: resolveValue({ model: { value: 0.8, author: null, ref: "rated" } }) } }), e, "n"))
    .toMatchObject({ kind: "backflow", detail: expect.stringContaining("backflow/deadhead") });
});

it("H5: only a complete host at this basis answers", () => {
  const e = encountersOf(SELF, paths, legs)[0]!.encounter;
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
  met[0]!.encounter.static = { kind: "host-calc", basis: "hb", inWg: 0.7, source: "host" };
  // Clause 2: 0.15 + (1 - 0.3) + 0.2 + 0.03 = 1.08 (old 0.68).
  expect(claimOf(facts({ met }))).toEqual({
    kind: "complete",
    basis: "b",
    requiredEspInWg: 1.08,
    coverage: [],
    blockingIds: [],
  });
  const refused = encountersOf(SELF, paths, legs, [
    { at: { elementId: 20, connector: 2 }, verdict: "refused", by: "human", ref: "work:test" },
  ]);
  expect(claimOf(facts({ met: refused })).kind).toBe("incomplete");
});

it("H5 clause 3: a priced run beyond N pays the downstream loss once", () => {
  const sharedLegs = { ...legs, downstream: leg("downstream", 50, 0.4) };
  const sharedPaths = [path("supply", ["a", "tie", "downstream"], 0.55), tieIn, paths[2]!];
  const met = encountersOf(SELF, sharedPaths, sharedLegs, [
    { at: { elementId: 20, connector: 2 }, verdict: "accepted", by: "human", ref: "work:test" },
  ]);
  met[0]!.encounter.static = { kind: "host-calc", basis: "hb", inWg: 0.7, source: "host" };
  // 0.55 full supply + 0.2 return + 0.03 allowances = 0.78; no extra 0.7 at N.
  expect(claimOf(facts({ paths: sharedPaths, legs: sharedLegs, met })))
    .toMatchObject({ kind: "complete", requiredEspInWg: 0.78 });
  // An unpriced onward run or a different branch is not evidence that N onward was paid.
  expect(pricesBeyond(met[0]!, sharedPaths, { ...sharedLegs, downstream: leg("downstream", 50, null) })).toBe(false);
  expect(pricesBeyond(met[0]!, [{ ...sharedPaths[0]!, legIds: ["r", "tie", "downstream"] }, ...sharedPaths.slice(1)], sharedLegs)).toBe(false);
});

it("a return tie-in takes no credit and adds nothing", () => {
  const onReturn = [
    path("supply", ["a"], 0.1),
    path("return", ["r"], 0.2, { kind: "sibling-fan", elementId: 200, fan: HOST, reached: "inlet" }),
  ];
  const met = encountersOf(SELF, onReturn, legs);
  expect(met[0]!.encounter).toMatchObject({ side: "return", verdict: "accepted", static: { kind: "none" } });
  // Clause 4: 0.1 supply + 0.2 return + 0.03 allowances + 0 host pressure = 0.33.
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
    "a merged part with no evidence, beside a reach that names only another fan's peer (P-047)": mergeCoverage([{}, { reach: { complete: false, unreadPeers: [peer(99)] } }]),
    "a walk that does not say whether it was truncated (P-047)": { walk: JSON.parse(JSON.stringify({ ...TEST_WALK, truncated: undefined })) }, // off the wire: the key is gone
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
