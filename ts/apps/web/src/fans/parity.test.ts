import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { ductsData, schemas } from "../ducts/neutral";
import { fansData } from "./neutral";
import { builtinRouteKeys, builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { leaks } from "../shell/visible-text";
import { snapshot } from "../ducts/test-fixture";

test("P01: native snapshot decoding preserves capture and bounded-system evidence", () => {
  const captured = {
    ...snapshot,
    sourceVersion: "native:1",
    systemReads: { completed: [900], missing: [] },
  };
  expect(schemas.snapshot.parse(captured)).toEqual(captured);
  expect(schemas.snapshot.safeParse({ ...captured, sourceVersion: 1 }).success).toBe(false);
  expect(schemas.snapshot.safeParse({ ...captured, nodes: "not a native snapshot" }).success).toBe(
    false,
  );
});

type Capability =
  | "P01"
  | "P02"
  | "P03"
  | "P04"
  | "P05"
  | "P06"
  | "P07"
  | "P08"
  | "P09"
  | "P10"
  | "P11"
  | "P12"
  | "P13"
  | "C01"
  | "C02"
  | "C03"
  | "C04"
  | "C05"
  | "C06"
  | "C07"
  | "C08"
  | "C09"
  | "C10"
  | "C11"
  | "C12"
  | "W01"
  | "W02"
  | "W03"
  | "W04"
  | "W05"
  | "W06"
  | "W07"
  | "W08"
  | "W09"
  | "W10"
  | "W11"
  | "W12"
  | "W13"
  | "W14"
  | "W15"
  | "R01"
  | "R02"
  | "R03"
  | "R04"
  | "R05"
  | "R06"
  | "R07"
  | "R08"
  | "R09"
  | "R10"
  | "R11"
  | "D01"
  | "D02"
  | "D03"
  | "A01"
  | "A02"
  | "A03"
  | "A04"
  | "X01"
  | "X02"
  | "X03"
  | "X04"
  | "X05";
type Coverage =
  | { readonly kind: "scenario"; readonly file: string; readonly name: string }
  | {
      readonly kind: "not-applicable" | "deferred" | "dropped-presentation";
      readonly reason: string;
    };
type BrowserMountCapabilities = Record<
  Capability,
  { readonly ducts: Coverage; readonly fans: Coverage }
>;
const scenario = (file: string, name: string) =>
  ({ ducts: { kind: "scenario", file, name }, fans: { kind: "scenario", file, name } }) as const;
const except = (kind: "not-applicable" | "deferred" | "dropped-presentation", reason: string) =>
  ({ ducts: { kind, reason }, fans: { kind, reason } }) as const;
// Every used declaration member needs a classification when the contract grows.
const members = {
  version: "discovery",
  key: "discovery",
  address: "discovery",
  name: "discovery",
  capabilities: "discovery",
  needs: "discovery",
  directory: "discovery",
  identities: "page",
  fields: "page",
  subject: "page",
  historyDetail: "work",
  work: "work",
  salvage: "work",
  readings: "readings",
  verbs: "chrome",
  panes: "chrome",
  layout: "chrome",
  stages: "chrome",
  stageOrder: "chrome",
  predicates: "chrome",
  cells: "work",
  workFields: "work",
  seeds: "fixture",
  resetOnTarget: "page",
  observe: "readings",
} as const satisfies Record<
  keyof typeof ductsData,
  "page" | "work" | "readings" | "chrome" | "fixture" | "discovery"
>;
// Independent 63-row oracle from mount-parity REVIEW §1. Removing a declaration never shrinks it.
export const parity = {
  P01: scenario("shell/admitted-mount.test.tsx", "slot census refuses unsupported bodies"),
  P02: scenario(
    "fans/recovery-bootstrap-gap.test.ts",
    "P02/P04: the application opens saved Ducts Work by document Address",
  ),
  P03: except(
    "deferred",
    "Controller explicitly excludes picker/reconnect P03 unless a witness fails on it.",
  ),
  P04: scenario(
    "fans/recovery-bootstrap-gap.test.ts",
    "P02/P04: the application opens saved Ducts Work by document Address",
  ),
  P05: scenario("shell/admitted-mount.test.tsx", "Page verbs also pass through transition"),
  P06: scenario("fans/identity.test.ts", "MUAS-1 restores from a direct URL"),
  P07: scenario("shell/admitted-place.test.ts", "inactive callbacks cannot read another Place"),
  P08: scenario("fans/identity.test.ts", "all and explicit none survive"),
  P09: scenario("shell/admitted-chrome.test.tsx", "unknown membership never prints ids"),
  P10: scenario("route/route-discovery.test.tsx", "every admitted builtin is discoverable once"),
  P11: scenario(
    "fans/identity.test.ts",
    "two retained Places keep separate subject, selection, query and pose",
  ),
  P12: scenario("shell/admitted-mount.test.tsx", "retained pane releases leases on hide"),
  P13: scenario("shell/admitted-chrome.test.tsx", "stage membership and gates"),
  C01: scenario("shell/admitted-chrome.test.tsx", "admitted declarations preserve pane frames"),
  C02: scenario(
    "shell/layout-floors.test.tsx",
    "folding a leaf does not fold its containing support branch",
  ),
  C03: scenario("shell/admitted-mount.test.tsx", "K4 pane refresh leaves an independent"),
  C04: scenario("shell/admitted-placement.test.ts", "placement validates rows"),
  C05: scenario("shell/admitted-chrome.test.tsx", "stage membership and gates"),
  C06: scenario(
    "shell/admitted-chrome.test.tsx",
    "Work undo follows current focus through portals",
  ),
  C07: scenario("../../host/tests/fans-native.test.ts", "D03/C07: admitted losses preview"),
  C08: scenario("shell/admitted-chrome.test.tsx", "review uses a portal"),
  C09: scenario("shell/worksharing-review.test.tsx", "workshared preview discloses every borrow"),
  C10: scenario("shell/admitted-chrome.test.tsx", "Escape cancels"),
  C11: scenario(
    "shell/admitted-mount.test.tsx",
    "stale-base refuses without recomputing or retrying",
  ),
  C12: scenario("ducts/graph.test.ts", "native loss and repair scopes stay inside"),
  W01: scenario("fans/cutover.test.ts", "exclusive admission has independent Ducts and Fans Work"),
  W02: scenario("shell/work-feed-client.test.ts", "atomic ack-feed acquisition wins"),
  W03: scenario("fans/cutover.test.ts", "human slot/drop/flow edits"),
  W04: scenario(
    "fans/recovery-bootstrap-gap.test.ts",
    "equal-Work Undo/Redo paths render the same label-only history",
  ),
  W05: scenario("fans/cutover.test.ts", "a new workspace reacquires Pea history"),
  W06: scenario("fans/cutover.test.ts", "one-press Revert is a new edit"),
  W07: scenario("fans/cutover.test.ts", "a new workspace reacquires Pea history"),
  W08: scenario(
    "shell/application-work-registry.test.ts",
    "ready receipts restore native undo barriers",
  ),
  W09: scenario(
    "shell/consent-timeline.test.tsx",
    "History records a write receipt and caller once",
  ),
  W10: scenario("shell/consent-timeline.test.tsx", "queued ducts write opens the route head"),
  W11: scenario(
    "../../host/tests/fans-native.test.ts",
    "real Pea %s controls the admitted sealed write",
  ),
  W12: scenario("shell/admitted-mount.test.tsx", "mount decodes by JournalSubmission.key"),
  W13: scenario(
    "fans/recovery-bootstrap-gap.test.ts",
    "a later Work edit hides named recovery evidence",
  ),
  W14: except(
    "dropped-presentation",
    "Controller default drops presentation-only gaps: recovery retains the shared confirmation and canonical salvage; route-specific row expansion is omitted.",
  ),
  W15: except(
    "not-applicable",
    "Legacy Ducts/Fans adapters never supplied the optional checkpoint owner port.",
  ),
  R01: scenario(
    "ducts/system-reads.test.ts",
    "joins reads by id, so a group two reads share counts once",
  ),
  R02: scenario("ducts/pricing.test.ts", "worker result has full solve/readiness parity"),
  R03: scenario("shell/admitted-mount.test.tsx", "K4 hide and fold release attempt leases"),
  R04: scenario("shell/admitted-mount.test.tsx", "K4 hide and fold release attempt leases"),
  R05: scenario("shell/admitted-mount.test.tsx", "K4 pane refresh leaves an independent"),
  R06: scenario("shell/admitted-mount.test.tsx", "K4 only successful receipt effects"),
  R07: except(
    "not-applicable",
    "Legacy Ducts/Fans adapters did not install the optional document-changed hook; native freshness remains required.",
  ),
  R08: except(
    "not-applicable",
    "This census query/Stop case is Families-specific; Ducts/Fans previews are commands.",
  ),
  R09: scenario("shell/admitted-mount.test.tsx", "fixture %s opens no live service"),
  R10: scenario("shell/admitted-geometry.test.ts", "subject changes retire overview and detail"),
  R11: scenario("shell/timeline.test.ts", "timeline preserves append order"),
  D01: scenario("ducts/sheet/fixture-inputs.test.ts", "admitted criteria editor resolves Work"),
  D02: scenario(
    "ducts/system-reads.test.ts",
    "joins reads by id, so a group two reads share counts once",
  ),
  D03: scenario("../../host/tests/fans-native.test.ts", "D03/C07: admitted losses preview"),
  A01: except("not-applicable", "Families-only consumer; outside Ducts/Fans unit."),
  A02: except("not-applicable", "Families-only consumer; outside Ducts/Fans unit."),
  A03: except("not-applicable", "Families-only consumer; outside Ducts/Fans unit."),
  A04: except("not-applicable", "Families-only consumer; outside Ducts/Fans unit."),
  X01: scenario("fans/cutover.test.ts", "a new workspace reacquires Pea history"),
  X02: scenario("route/route-discovery.test.tsx", "hosted admitted address retains the call"),
  X03: scenario("workbench/hosted-route.test.tsx", "workbench mounts the admitted registration"),
  X04: scenario("shell/admitted-attention.test.tsx", "admitted /fans publishes attention; a route without an agent field publishes none"),
  X05: scenario("route/route-discovery.test.tsx", "every admitted builtin is discoverable once"),
} satisfies BrowserMountCapabilities;

test("the independent Ducts/Fans census classifies all 63 rows with an executable case or a consumer ruling", () => {
  expect(Object.keys(parity)).toHaveLength(63);
  expect(Object.keys(members).sort()).toEqual(Object.keys(ductsData).sort());
  for (const [id, row] of Object.entries(parity))
    for (const coverage of Object.values(row)) {
      if (coverage.kind === "scenario") {
        const source = readFileSync(new URL(`../${coverage.file}`, import.meta.url), "utf8");
        expect(source, `${id} case ${coverage.file}`).toContain(coverage.name);
        expect(source).toMatch(/(?:test|it)[.(]/);
      } else expect(coverage.reason.length, id).toBeGreaterThan(20);
    }
});

test("one builtin manifest enrolls Ducts and Fans exactly once and the catalog lists each once", async () => {
  expect(builtinRouteKeys.length).toBeGreaterThan(0);
  expect(builtinRouteKeys.filter((key) => key === "ducts")).toHaveLength(1);
  expect(builtinRouteKeys.filter((key) => key === "fans")).toHaveLength(1);
  // Pea's catalog lists each admitted route once (ADR 0030 rule 1); the admitted owner registers it.
  const listed = createRouteRegistrations().map((row) => row.spec.route);
  expect(listed.filter((key) => key === "ducts")).toHaveLength(1);
  expect(listed.filter((key) => key === "fans")).toHaveLength(1);
  const owner = await loadBuiltinRoute("ducts", builtinRouteStamp("ducts"));
  const fans = await loadBuiltinRoute("fans", builtinRouteStamp("fans"));
  expect(owner.ok && fans.ok).toBe(true);
  if (!owner.ok || !fans.ok) throw Error(JSON.stringify({ owner, fans }));
  // Q2: each route owns its Work and admission fingerprint.
  expect(fans.route.workFingerprint).not.toBe(owner.route.workFingerprint);
});

test("the legacy Ducts/Fans pane, reading and write census cannot shrink with the new declaration", () => {
  expect(Object.keys(ductsData.fields).sort()).toEqual([
    "contextRadiusFt",
    "contextStyle",
    "encoding",
    "fan",
    "inputSearch",
    "inputSort",
    "layers",
    "picture",
    "rulingSearch",
    "rulingSort",
    "sceneView",
    "selected",
    "sheetPath",
    "stage",
    "system",
    "systemSearch",
    "systemSort",
    "threadSearch",
    "threadSort",
    "treeSearch",
    "treeSort",
    "viewport",
  ]);
  // Q2: fan-owned inputs moved to /fans, so Ducts has no Inputs pane.
  expect(Object.keys(ductsData.panes).sort()).toEqual([
    "e-inbox",
    "e-picture",
    "e-rules",
    "e-rules-all",
    "e-sidebar",
    "e-systems",
  ]);
  expect(Object.keys(fansData.panes).sort()).toEqual([
    "sheet-inputs",
    "sheet-ledger",
    "sheet-picture",
    "sheet-roster",
  ]);
  expect(Object.keys(ductsData.readings).sort()).toEqual([
    "catalogs",
    "ducts",
    "fanPlan",
    "fans",
    "fansWork",
    "healPlan",
    "lossPlan",
    "meshes",
    "pricing",
    "roster",
    "sheet",
    "sheetSnapshot",
    "tables",
  ]);
  expect(Object.keys(ductsData.verbs).sort()).toEqual([
    "assign",
    "browse",
    "edit",
    "heal",
    "losses",
    "scope",
    "sheetEdit",
  ]);
  const names = new Set([...Object.keys(ductsData.cells), ...Object.keys(ductsData.workFields)]);
  expect(Object.keys(schemas.work.shape).filter((key) => !names.has(key))).toEqual([]);
  for (const data of [ductsData, fansData])
    for (const word of [
      data.name,
      ...Object.values(data.panes).flatMap((pane) => [pane.label, pane.purpose]),
      ...Object.values(data.verbs).map((verb) => verb.label),
    ])
      expect(leaks(word, []), word).toEqual([]);
});
