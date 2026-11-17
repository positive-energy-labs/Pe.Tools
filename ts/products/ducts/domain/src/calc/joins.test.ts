import { expect, test, vi } from "vite-plus/test";
import { BLIND_PART } from "../system-reads.ts";
import { nodeOf, snapshotOf } from "../test-snapshot.ts";
import { coverageOf, wholeCoverage } from "./coverage.ts";
import { followAcceptedJoins, mergeFar } from "./joins.ts";

const walk = { startId: 1, hops: 2, elementsReached: 3, openEnds: 1, truncated: false, elapsedMs: 1, unreadPeers: [], candidates: [] };

// R1: the join continuation lives in the domain; this file imports nothing from the host.
test("an accepted join reads its unwalked side once, and the walked copy replaces the candidate", async () => {
  const near = snapshotOf({ walk, nodes: [nodeOf(1, "equipment"), { ...nodeOf(2, "fitting"), reason: "candidate" } as never] });
  const far = snapshotOf({
    walk: { ...walk, startId: 2 },
    document: { ...near.document, readAt: "later" },
    nodes: [{ ...nodeOf(2, "fitting"), family: "walked copy" }, nodeOf(3, "terminal")],
  });
  const read = vi.fn(async () => far);
  const rulings = [
    { pair: ["1:0", "2:0"], verdict: "accept" },
    { pair: ["1:1", "9:0"], verdict: "ignore" },
  ];
  const merged = await followAcceptedJoins(near, rulings, read);
  expect(read).toHaveBeenCalledExactlyOnceWith(2);
  expect(merged.nodes.map((n) => n.id).sort()).toEqual([1, 2, 3]);
  expect(merged.nodes.find((n) => n.id === 2)).toMatchObject({ family: "walked copy" });
  // The near read stands: its walk identity, and the document its cohorts were read at.
  expect(merged.walk?.startId).toBe(1);
  expect(merged.document).toBe(near.document);
  // No accepted join with one side unwalked: no read, the same snapshot.
  expect(await followAcceptedJoins(near, [rulings[1]!], read)).toBe(near);
});

test("a near walked copy stands over the far read's copy of the same element", () => {
  const near = snapshotOf({ walk, nodes: [{ ...nodeOf(2, "fitting"), family: "near" }] });
  const far = snapshotOf({ walk, nodes: [{ ...nodeOf(2, "fitting"), family: "far" }] });
  expect(mergeFar(near, far).nodes).toEqual([expect.objectContaining({ family: "near" })]);
});

// P-033(b) and (e): the first read's walk identity stands, and nothing the second walk found is dropped.
test("the merge keeps the far walk's unread peers, candidates and counts", () => {
  const end = { elementId: 6, connector: 0, point: [0, 0, 0], candidateCount: 0, candidateIds: [] };
  const peer = { elementId: 7, connector: 1 };
  const merged = mergeFar(
    snapshotOf({ walk }),
    snapshotOf({ walk: { ...walk, startId: 9, truncated: true, unreadPeers: [peer], candidates: [end] } }),
  );
  expect(merged.walk).toMatchObject({ startId: 1, hops: 4, elementsReached: 6, openEnds: 2, truncated: true, unreadPeers: [peer], candidates: [end] });
  // A far read that carries no coverage evidence is lost coverage, never a pass.
  expect(mergeFar(snapshotOf({ walk }), snapshotOf()).reach).toEqual({ complete: false, unreadPeers: [BLIND_PART] });
});

// P-047: another fan's peer in the merged reach must not explain away the blind read.
test("a blind read merged beside a reach that names only another fan's peer is not whole", () => {
  const foreign = { elementId: 99, connector: 1 };
  const held = { nodes: [nodeOf(30, "fitting"), nodeOf(99, "fitting")] };
  const merged = mergeFar(
    snapshotOf({ ...held, walk: undefined, reach: { complete: false, unreadPeers: [foreign] } }),
    snapshotOf({ walk: undefined, reach: undefined }),
  );
  expect(merged.reach?.unreadPeers).toEqual([foreign, BLIND_PART]);
  expect(wholeCoverage(coverageOf(merged, new Set([30])))).toBeNull();
});
