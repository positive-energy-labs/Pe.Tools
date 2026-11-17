import { expect, it } from "vite-plus/test";
import { address, bindWork, fansDocumentSchema } from "@pe/agent-contracts";
import { ductsRouteState, ductsDocumentSchema, stagedDucts, encounterPatches } from "@pe/duct-systems-contract/ducts";
import { RouteWorkspace } from "@pe/runtime";
import { encounterRulings } from "@pe/ducts-domain/calc/inputs";
import { TEST_COVERAGE, TEST_FIRM } from "@pe/ducts-domain/test-inputs";
import { snapshotOf, nodeOf, uniqueIdOf } from "@pe/ducts-domain/test-snapshot";
import { publishedCalcExample } from "@pe/ducts-domain/published-calcs.fixture";
import { resolveInputs } from "@pe/ducts-domain/calc/inputs";
import { claimOf, encountersOf, hostStatic } from "@pe/fans-domain/calc/encounters";
import { mintWriteRequest } from "@pe/fans-domain/calc/write-request";
import type { CalcPath, Leg } from "@pe/fans-contract/fan-calc";
import type { FanIssue } from "@pe/fans-contract/fans-inputs";
import { describeCloser, DUCTS_FIXES } from "./closer.ts";

const leg: Leg = { id: "a", elementId: 20, kind: "duct", outConnector: 0, flowCfm: 100,
  flowSource: "test", velocityFpm: 500, lossInWg: 0.1, lossSource: { kind: "friction", ref: "test" },
  equivalentFt: null, evidence: { kind: "unpriced", issueId: "" } };
const fan = { unitId: 300, portIndex: 0 }, host = { unitId: 200, portIndex: 0 };
const paths: CalcPath[] = [ { side: "supply", legIds: ["a"], knownInWg: 0.1, blockerIds: [],
  end: { kind: "sibling-fan", elementId: 200, fan: host, reached: "discharge" } },
  { side: "return", legIds: ["r"], knownInWg: 0.2, blockerIds: [], end: { kind: "terminal", elementId: 90 } } ];
const legs = { a: leg, r: { ...leg, id: "r", elementId: 32, lossInWg: 0.2 } };
const issue: FanIssue = { id: "backflow:20:0", kind: "backflow", elementId: 20, severity: "blocking",
  closer: { kind: "encounter", encounter: encountersOf(fan, paths, legs)[0]!.encounter } };

it.each(["connect", "ignore"] as const)("closer stages %s through duct-systems Work, then resolves the guest claim", async choice => {
  const saved = new Map<string, unknown>();
  const workspace = new RouteWorkspace({ registrations: [{ spec: ductsRouteState }],
    store: { getState: async ({ route }) => saved.get(route), setState: async ({ route, value }) => { saved.set(route, value); } } });
  const key = bindWork("duct-systems", address("C:/test.rvt"));
  const row = { ...issue, effectInWg: null, detail: "tie-in", closer: { kind: "ruling" as const, note: "" } };
  const closer = describeCloser(row, null, { terminalDrop: null, nameOf: () => "tie-in", wait: null, fix: () => issue.closer });
  expect(closer.action?.kind).toBe("encounter");
  expect(DUCTS_FIXES.has(closer.action!.kind)).toBe(true);
  const staged = await workspace.apply(key, "duct-systems", "human", encounterPatches(issue, choice, null), 0);
  expect(staged.ok).toBe(true);
  const work = ductsDocumentSchema.parse((await workspace.read(key, "duct-systems"))!.doc);
  const met = encountersOf(fan, paths, legs, encounterRulings({ work: { assumptions: stagedDucts(work, fansDocumentSchema.parse({})).assumptions } }));
  expect(met[0]!.encounter.verdict).toBe(choice === "connect" ? "accepted" : "refused");
  const pressure = hostStatic({ network: "n", claim: { kind: "complete", basis: "hb", requiredEspInWg: 1, coverage: [], blockingIds: [] },
    paths: [{ ...paths[0]!, legIds: ["up", "a"] }], legs: { up: { ...leg, elementId: 10, lossInWg: 0.3 }, a: leg } }, met[0]!.encounter, "n");
  if ("kind" in pressure) throw Error(JSON.stringify(pressure));
  if (choice === "connect") met[0]!.encounter.static = { kind: "host-calc", ...pressure };
  const claim = claimOf({ basis: "b", paths, legs, met, coverage: TEST_COVERAGE, gaps: [], blockingIds: [], allowanceInWg: { supply: 0, return: 0 } });
  if (choice === "ignore") { expect(claim.kind).toBe("incomplete"); return; }
  expect(claim).toMatchObject({ kind: "complete", requiredEspInWg: 1 }); // 0.1 + (1 - 0.3) + 0.2
  if (claim.kind !== "complete") throw Error("Expected complete");
  const at = "2026-11-17T00:00:00Z", prior = publishedCalcExample();
  const snapshot = snapshotOf({ document: { title: "tie-in", readAt: at, elapsedMs: 0, networkBasedCalculations: true }, nodes: [nodeOf(300, "equipment")],
    parameterCohorts: [{ parameter: "ESP", owner: { kind: "instance", id: 300 }, complete: true, basis: at, members: [{ elementId: 300, uniqueId: uniqueIdOf(300) }] }] });
  const sheet = { ...prior, fan: { ...prior.fan, ...fan }, claim, legs, walkedElementIds: [] };
  expect(mintWriteRequest(claim, sheet, { snapshot, fan, roster: [], grids: {}, inputs: resolveInputs({ snapshot, firm: TEST_FIRM }) },
    { appliedAt: at, slots: { requiredEsp: "ESP" }, peerClaims: new Map(), rulings: {}, storeDeletes: { roles: [], verdicts: [] } }).equipment).toEqual([{ id: 300, externalStaticInWg: 1 }]);
});

it("a deadhead has no accept closer and staging acceptance is refused", () => {
  const deadhead: FanIssue = { ...issue, closer: { kind: "none", reason: "backflow/deadhead" } };
  const closer = describeCloser({ ...issue, effectInWg: null, detail: "", closer: { kind: "ruling", note: "backflow/deadhead" } }, null,
    { terminalDrop: null, nameOf: () => "tie-in", wait: null, fix: () => deadhead.closer });
  expect(closer.action).toBeNull();
  expect(() => encounterPatches(deadhead, "connect", null)).toThrow("cannot be ruled");
});
