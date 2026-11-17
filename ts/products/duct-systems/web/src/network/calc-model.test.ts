import { expect, test } from "vite-plus/test";
import { buildCalc } from "@pe/fans-domain/calc/index";
import { inputsFor, TEST_WALK, withFamilyFlipped } from "@pe/fans-domain/calc/test-inputs";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { VOCABULARY } from "@pe/ducts-domain/calc/scoped-snapshot";
import type { FanPort } from "@pe/ducts-domain/roster";
import {
  connOf,
  ductOf,
  groupOf,
  issueOf,
  nodeOf,
  round,
  snapshotOf,
} from "@pe/ducts-domain/test-snapshot";
import { buildCalcTree, type CalcTreeNode } from "./calc-model.ts";
import type { TreeNode } from "./model.ts";
import retained from "@pe/fans-domain/calc/fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "@pe/fans-domain/calc/fixtures/manual-d-tables.json" with { type: "json" };
import { calcSnapshot } from "@pe/ducts-domain/calc/scoped-snapshot";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { healPlan } from "@pe/ducts-domain/heal";

/** Two discharge grilles, one shared intake louver. Typed tee drop isolates projection behavior. */
function example(shared = false) {
  const c = (index: number, to: [number, number], classification?: string) =>
    connOf(index, to, {
      ...round(10),
      direction: "out",
      ...(classification ? { classification } : {}),
    });
  const at = { groupId: "g1", systemName: "Air" };
  // A walk that read every peer: without it no calc may claim a whole coverage (P-028).
  const snapshot = snapshotOf({
    walk: TEST_WALK,
    groups: [groupOf("g1", { rootIds: shared ? [100, 200] : [100], systemNames: ["Air"] })],
    nodes: [
      nodeOf(100, "equipment", { family: "MUAS", connectors: [c(0, [11, 0]), c(1, [20, 0])] }),
      nodeOf(20, "terminal", { ...at, connectors: [c(0, [100, 1], "SupplyAir")] }),
      nodeOf(30, "terminal", { ...at, connectors: [c(0, [13, 1], "OutdoorAir")] }),
      nodeOf(12, "fitting", {
        ...at,
        partType: "Tee",
        connectors: [c(0, [11, 1]), c(1, [13, 0]), ...(shared ? [c(2, [14, 0])] : [])],
      }),
      ...(shared
        ? [
            nodeOf(200, "equipment", { family: "ERV", connectors: [c(0, [14, 1]), c(1, [40, 0])] }),
            nodeOf(40, "terminal", { ...at, connectors: [c(0, [200, 1], "SupplyAir")] }),
          ]
        : []),
    ],
    segments: [
      ductOf(11, {
        ...at,
        ...round(10),
        lengthFt: 10,
        connectors: [c(0, [100, 0]), c(1, [12, 0])],
      }),
      ductOf(13, { ...at, ...round(10), lengthFt: 5, connectors: [c(0, [12, 1]), c(1, [30, 0])] }),
      ...(shared
        ? [
            ductOf(14, {
              ...at,
              ...round(10),
              lengthFt: 4,
              connectors: [c(0, [12, 2]), c(1, [200, 0])],
            }),
          ]
        : []),
    ],
  });
  const roster: FanPort[] = (shared ? [100, 200] : [100]).map((unitId) => ({
    unitId,
    portIndex: 1,
    inletPortIndex: 0,
    tag: `F-${unitId}`,
    side: "supply",
    kind: "air-handler",
    source: "ruling",
  }));
  const inputs = inputsFor(snapshot, {
    endCfm: shared
      ? { 100: 150, 20: 150, 30: 200, 200: 50, 40: 50 }
      : { 100: 150, 20: 150, 30: 150 },
    drops: shared ? { 12: 0, 20: 0.03, 30: 0.04, 40: 0.03 } : { 12: 0, 20: 0.03, 30: 0.04 },
  });
  return {
    snapshot,
    sheets: roster.map((fan) => buildCalc({ snapshot, roster, fan, grids: {}, inputs })),
  };
}
const flatten = (nodes: readonly CalcTreeNode[]): CalcTreeNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

test("one fan: the existing tree view shape carries full fan pressure and each sheet path", () => {
  const { snapshot, sheets } = example();
  const trees = buildCalcTree(snapshot, sheets);
  const compatible: TreeNode[] = trees;
  expect(compatible).toBe(trees);
  const fan = trees[0]!.children[0]!;
  expect(sheets[0]!.totals.requiredEspInWg).toBeGreaterThan(0);
  expect(fan.total).toBe(sheets[0]!.totals.requiredEspInWg);
  expect(fan.children.map((n) => n.total)).toEqual(sheets[0]!.paths.map((p) => p.knownInWg));
  expect(trees[0]!.message).toBeNull();
  expect(
    flatten(trees)
      .filter((n) => n.kind === "element")
      .map((n) => n.id),
  ).toEqual(expect.arrayContaining([11, 12, 13, 20, 30]));
});

test("shared trunk: both actual sheets retain their path prices without a group pressure or ownership", () => {
  const { snapshot, sheets } = example(true);
  const trees = buildCalcTree(snapshot, sheets);
  const all = flatten(trees);
  expect(trees[0]!.total).toBeNull();
  expect(trees[0]!.message).toBe("Shared network; read pressure per fan");
  const shared = all.filter((n) => n.kind === "element" && n.id === 13);
  expect(shared).toHaveLength(2);
  expect(shared.map((n) => n.fan!.unitId)).toEqual([100, 200]);
  expect(shared[0]!.self).toBeGreaterThan(0);
  expect(shared[0]!.self).toBe(shared[1]!.self);
  for (const sheet of sheets) {
    const duct = Object.values(sheet.legs).find((leg) => leg.elementId === 13)!;
    expect(duct.flowCfm).toBe(200);
    expect(shared.find((n) => n.fan!.unitId === sheet.fan.unitId)!.self).toBe(duct.lossInWg);
  }
  expect(new Set(all.map((n) => n.key)).size).toBe(all.length);
  expect(buildCalcTree(snapshot, [...sheets].reverse())[0]!.children.map((n) => n.total)).toEqual(
    trees[0]!.children.map((n) => n.total).reverse(),
  );
});

test("fanless: snapshot elements and native health survive with no number and one fan ruling line", () => {
  const { snapshot } = example();
  snapshot.segments.push(
    ductOf(99, {
      groupId: "g1",
      polyline: [
        [1000, 0, 0],
        [1001, 0, 0],
      ],
      connectors: [connOf(0, null, { point: [1000, 0, 0] })],
    }),
  );
  snapshot.issues.push(
    issueOf("open:99:0", "open-end", 99, { connector: 0, note: "open duct end" }),
  );
  const trees = buildCalcTree(snapshot, []);
  expect(trees[0]!.message).toBe("Rule a fan to price this system");
  expect(trees[0]!.health).toEqual(snapshot.issues);
  const all = flatten(trees);
  expect(all.every((n) => n.total === null && n.self === null)).toBe(true);
  expect(all.filter((n) => n.message)).toHaveLength(1);
  expect(
    all
      .filter((n) => n.kind === "element")
      .map((n) => n.id)
      .sort((a, b) => a! - b!),
  ).toEqual([11, 12, 13, 20, 30, 99]);
  expect(healPlan(snapshot).groups[0]!.items).toContainEqual({
    key: "cap:99:0",
    kind: "cap",
    how: "cap",
    end: "99:0",
    gapIn: 0,
    ids: [99],
    covers: ["open:99:0"],
  });
});

test("a blocked sheet keeps known arithmetic separate and retains branches no sheet reaches", () => {
  const { snapshot, sheets } = example();
  const sheet = sheets[0]!;
  const id = Object.keys(sheet.legs).find((id) => sheet.legs[id]!.elementId === 13)!;
  sheet.legs[id]!.lossInWg = null;
  const path = sheet.paths.find((p) => p.legIds.includes(id))!;
  path.blockerIds = ["not-priced:13"];
  path.knownInWg = path.legIds.reduce((sum, id) => sum + (sheet.legs[id]!.lossInWg ?? 0), 0);
  sheet.totals.requiredEspInWg = null;
  snapshot.segments.push(ductOf(99, { groupId: "g1" }));
  const tree = buildCalcTree(snapshot, sheets);
  const run = tree[0]!.children[0]!.children.find((r) => r.blockerIds.includes("not-priced:13"))!;
  expect(run.total).toBeNull();
  expect(run.knownInWg).toBe(path.knownInWg);
  expect(run.children.find((n) => n.id === 13)!.unpriced).not.toBeNull();
  expect(flatten(tree).find((n) => n.id === 99)!.total).toBeNull();
});

test("a system scope retains full sheet identity without relabelling a clipped subtotal as ESP", () => {
  const { snapshot, sheets } = example();
  const trees = buildCalcTree(snapshot, sheets, ["g1"], new Set([13]));
  const fan = trees[0]!.children[0]!;
  expect(fan.total).toBe(sheets[0]!.totals.requiredEspInWg);
  expect(fan.name).toContain("full fan sheet");
  expect(flatten(trees).some((n) => n.id === 30)).toBe(true);
  expect(buildCalcTree(snapshot, sheets, ["absent"])).toEqual([]);
});

test("retained Manual D geometry: fan boundaries and a sibling's shared intake stay distinct", () => {
  // The capture contains no native groups. This existing adapter gives the captured ids one
  // navigation group, while the legs, connectivity and native health remain captured evidence.
  // Q4 (2026-11-16): MUAS-1's family reads against its network, so the capture states the roles it was certified under (`manual-d.test.ts`).
  const snapshot = calcSnapshot(
    withFamilyFlipped(nativeResponseSchema("ducts.snapshot.walk").parse({
      ...retained, walk: { ...retained.walk, unreadPeers: [] }, vocabulary: VOCABULARY,
    }), 14577391),
  );
  const suggested = suggestRoster(snapshot);
  const roster = [...suggested.fans, ...suggested.suggestions];
  const grids = toGrids({ tables });
  const sheets = [14577391, 13760867, 6104810].map((unitId) =>
    buildCalc({
      snapshot,
      roster,
      grids,
      fan: roster.find((fan) => fan.unitId === unitId)!,
      inputs: inputsFor(snapshot, {
        endCfm: unitId === 14577391 ? { 14577391: 900 } : {},
        drops: { 14577394: 0.0132, 14577396: 0.18, 14088043: 0.026 },
        rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
      }),
    }),
  );
  const trees = buildCalcTree(snapshot, sheets);
  const fans = trees[0]!.children.filter((n) => n.fan != null);
  expect(fans[0]!.total).toBeCloseTo(2.658079, 6);
  expect(fans[1]!.total).toBeNull();
  expect(fans[1]!.blockerIds).toEqual(
    expect.arrayContaining(["open-end:13771256:0", "open-end:8734004:1"]),
  );
  const louver = flatten(trees).filter((n) => n.kind === "element" && n.id === 14088043);
  // FC-23 is a downstream merge boundary, not a second intake owner. FC-17 is the sibling
  // actually sharing this louver. Do not turn network membership into path membership.
  expect(new Set(louver.map((n) => n.fan?.unitId))).toEqual(new Set([14577391, 6104810]));
  const segmentIds = new Set(snapshot.segments.map((s) => s.id));
  const siblingIds = new Set(Object.values(sheets[2]!.legs).map((l) => l.elementId));
  const sharedDucts = Object.values(sheets[0]!.legs).filter(
    (l) => segmentIds.has(l.elementId) && siblingIds.has(l.elementId),
  );
  expect(sharedDucts.length).toBeGreaterThan(0);
  for (const duct of sharedDucts) {
    const drawn = flatten(trees).filter((n) => n.kind === "element" && n.id === duct.elementId);
    expect(new Set(drawn.map((n) => n.fan?.unitId))).toEqual(new Set([14577391, 6104810]));
  }
  for (const [i, fan] of fans.entries()) {
    expect(fan.children.map((r) => r.knownInWg)).toEqual(sheets[i]!.paths.map((p) => p.knownInWg));
    expect(fan.children.map((r) => r.blockerIds)).toEqual(
      sheets[i]!.paths.map((p) => p.blockerIds),
    );
  }
});
