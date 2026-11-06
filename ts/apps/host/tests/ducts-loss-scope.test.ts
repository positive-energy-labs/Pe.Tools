// U4 wires the real fans Work for callers without one.
import { neutralFansWork } from "@pe/agent-contracts";
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import { lossSnapshot, unwrittenCells, unwrittenReason } from "../src/ducts-actions.ts";
import { scopeApplyRequest } from "@pe/ducts-domain/staged";
import { mergeSnapshots } from "../src/ducts-walk.ts";
import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import { writeSeal } from "../src/work-write-boundary.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsDesign, fansDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { price, applyRequest } from "@pe/ducts-domain/pricing";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";

test("fan preview survives identical re-pricing but rejects changed model inputs", () => {
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const work = ductsDesign(
    null,
    fansDocumentSchema.parse({
      componentDrops: { "14088043": { edit: { value: { inWg: 0.026 } } } },
    }),
  );
  const handle = {
    key: {
      binding: "open" as const,
      route: "ducts",
      target: null,
      open: { session: "A", openId: "doc" },
    },
    revision: 1,
  };
  const seal = (s: typeof snapshot) =>
    writeSeal({
      request: applyRequest(s, price(s, {}, work, (work) ?? neutralFansWork, EMPTY_CATALOGS), "", []),
      input: work,
      work: handle,
      incarnation: { openId: "doc" },
      documentMark: { session: "A", openId: "doc", observedSince: null, changedAt: null },
      consumed: [],
      evidence: ductWriteEvidence(s),
    });
  snapshot.walk = {
    startId: 14577391,
    hops: 1,
    elementsReached: snapshot.nodes.length,
    openEnds: 0,
    candidates: [],
    truncated: false,
    elapsedMs: 12,
  };
  // Every set-valued collection may be enumerated differently by a fresh native read.
  const permute = (value: unknown, key = "", parent = ""): unknown => {
    if (Array.isArray(value)) {
      const items = value.map(item => permute(item, "", key));
      return ["point", "tapPoint", "facing", "widthAxis", "polyline", "order", "criticalPath"].includes(key) || parent === "polyline" || (key === "ports" && parent === "inline") ? items : items.reverse();
    }
    return value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, permute(v, k, key)])) : value;
  };
  const facts = ductWriteEvidence(snapshot);
  const permuted = permute(snapshot) as typeof snapshot;
  Object.assign(permuted.document, { readAt: "new clock", elapsedMs: 900, futureDiagnostic: "new" });
  Object.assign(permuted.walk!, { elapsedMs: 1000, futureDiagnostic: "new" });
  for (const node of permuted.nodes) Object.assign(node, { futureDiagnostic: "new" });
  expect(ductWriteEvidence(permuted)).toEqual(facts);
  const geometry = structuredClone(snapshot);
  geometry.nodes[0]!.connectors[0]!.point[0]! += 1;
  expect(ductWriteEvidence(geometry)).not.toEqual(facts);
  const topology = structuredClone(snapshot);
  topology.nodes[0]!.connectors[0]!.connectedTo = { elementId: 999, connector: 4 };
  expect(ductWriteEvidence(topology)).not.toEqual(facts);
  const preview = seal(snapshot);
  const reread = structuredClone(snapshot);
  reread.document.readAt = "2026-11-02T12:00:00Z";
  reread.document.elapsedMs += 100;
  reread.walk!.elapsedMs += 100;
  reread.nodes.reverse();
  for (const node of reread.nodes) node.connectors.reverse();
  for (const segment of reread.segments) segment.connectors.reverse();
  for (const issue of reread.issues) issue.near?.ports.reverse();
  expect(seal(reread)).toEqual(preview);
  reread.slots.fanFlow = "another parameter";
  expect(seal(reread)).not.toEqual(preview);
});

test("fan loss preparation reads both sides and carries authored drops into preview", async () => {
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const read = vi.fn(async () => snapshot);
  expect(await lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, read)).toBe(snapshot);
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "from", unitId: 14577391 });
  const truncated = mergeSnapshots(snapshot, {
    ...snapshot,
    walk: { startId: 1, hops: 1, elementsReached: 1, openEnds: 0, candidates: [], elapsedMs: 1, truncated: true },
  });
  await expect(lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, async () => truncated))
    .rejects.toThrow("truncated");
  const node = snapshot.nodes.find((n) => n.id === 14088043)!;
  expect(node).toBeTruthy();
  const work = ductsDesign(
    null,
    fansDocumentSchema.parse({
      componentDrops: { [node.id]: { edit: { value: { inWg: 0.026 } } } },
    }),
  );
  const request = applyRequest(
    snapshot,
    price(snapshot, {}, work, (work) ?? neutralFansWork, EMPTY_CATALOGS),
    "2026-11-02T10:00:00Z",
    [],
  );
  expect(request.components).toContainEqual(expect.objectContaining({ id: node.id, inWg: 0.026 }));
});


test("unscoped losses do not fire a healing read", async () => {
  const read = vi.fn();
  await expect(lossSnapshot(undefined, read)).rejects.toThrow("stage a scope before previewing losses");
  expect(read).not.toHaveBeenCalled();
});

test("an authored terminal flow inside a fan walk with no network groups reaches the scoped plan", () => {
  // The real-twin fan walk has no groups and no node groupId, like the Snowdon walk that planned an empty request.
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(
    JSON.parse(readFileSync(new URL("../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json", import.meta.url), "utf8")),
  );
  expect(snapshot.groups).toHaveLength(0);
  const [authored, other] = snapshot.nodes.filter((n) => n.kind === "terminal");
  const request = (walk: boolean) => {
    // As the plan reads it: the staged terminalFlow slot is the observed one on the authored terminal.
    const nodes = snapshot.nodes.map((n) => (n.id === authored!.id ? { ...n, flowParameter: "Flow" } : n));
    const s = { ...snapshot, nodes, walk: walk ? { startId: 14577391, hops: 1, elementsReached: snapshot.nodes.length, openEnds: 0, candidates: [], truncated: false, elapsedMs: 1 } : undefined };
    const work = ductsDesign(null, fansDocumentSchema.parse({
      flows: { [authored!.id]: { edit: { value: { cfm: 123, source: "controlled sample proof" } } } },
      parameters: { terminalFlow: { edit: { value: "Flow" } } },
    }));
    return scopeApplyRequest(applyRequest(s, price(s, {}, work, work ?? neutralFansWork, EMPTY_CATALOGS), "", []), s.store, [["flows", String(authored!.id)]]);
  };
  expect(request(true).terminalFlows).toEqual([expect.objectContaining({ id: authored!.id, cfm: 123 })]);
  // Derived flows keep their network guard: no group with an air mover, no write.
  expect(request(true).terminalFlows.some((row) => row.id === other!.id)).toBe(false);
  // Outside a known fan walk an ungrouped flow still has no air mover to stand on.
  expect(request(false).terminalFlows).toEqual([]);
});

test("a requested write cell that derives no write is refused, never planned as an empty request", () => {
  const empty = { fittings: [], terminals: [], components: [], equipment: [], terminalFlows: [], equipmentFlows: [] } as never;
  expect(unwrittenCells(empty, [["flows", "1380293"], ["rules", "elbow"], ["calculation", "x"]])).toEqual([["flows", "1380293"]]);
  expect(unwrittenCells({ ...(empty as object), terminalFlows: [{ id: 1380293, cfm: 123 }] } as never, [["flows", "1380293"]])).toEqual([]);
});

test("an unwritten cell names why: an empty or consumed Work cell is not a staged value", () => {
  // The preserved r82 shape: writeIntent still names both ESP cells after r67 published both edits.
  const fans = fansDocumentSchema.parse({
    esp: { "14577391": { edit: null }, "10016301": { edit: { value: { inWg: 2.7 } } } },
  });
  const staged = stagedDucts(null, fans);
  expect(unwrittenReason(staged, ["esp", "14577391"])).toMatch(/no staged edit/);
  // A staged cell that still derives nothing is a different case; it is never called empty.
  expect(unwrittenReason(staged, ["esp", "10016301"])).toMatch(/^staged/);
});
