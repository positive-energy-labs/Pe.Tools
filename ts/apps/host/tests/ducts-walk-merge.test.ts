import { coverageOf, wholeCoverage } from "@pe/ducts-domain/sheet/coverage";
import { BLIND_PART } from "@pe/ducts-domain/system-reads";
import { nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { expect, test } from "vite-plus/test";
import { mergeSnapshots } from "../src/ducts-walk.ts";

// P-033(b) and (e): the first read's walk identity stands, and nothing the second walk found is dropped.
test("the host walk merge keeps the second walk's unread peers, candidates and counts", () => {
  const walk = { startId: 1, hops: 2, elementsReached: 3, openEnds: 1, truncated: false, elapsedMs: 1, unreadPeers: [], candidates: [] };
  const end = { elementId: 6, connector: 0, point: [0, 0, 0], candidateCount: 0, candidateIds: [] };
  const peer = { elementId: 7, connector: 1 };
  const merged = mergeSnapshots(
    snapshotOf({ walk }),
    snapshotOf({ walk: { ...walk, startId: 9, unreadPeers: [peer], candidates: [end] } }),
  );
  expect(merged.walk).toMatchObject({ startId: 1, hops: 4, elementsReached: 6, openEnds: 2, unreadPeers: [peer], candidates: [end] });
  // A second read that carries no coverage evidence is lost coverage, never a pass.
  expect(mergeSnapshots(snapshotOf({ walk }), snapshotOf()).reach).toEqual({ complete: false, unreadPeers: [BLIND_PART] });
});

// P-047: another fan's peer in the merged reach must not explain away the blind read.
test("a blind read merged beside a reach that names only another fan's peer is not whole", () => {
  const foreign = { elementId: 99, connector: 1 };
  const held = { nodes: [nodeOf(30, "fitting"), nodeOf(99, "fitting")] };
  const merged = mergeSnapshots(
    snapshotOf({ ...held, walk: undefined, reach: { complete: false, unreadPeers: [foreign] } }),
    snapshotOf({ walk: undefined, reach: undefined }),
  );
  expect(merged.reach?.unreadPeers).toEqual([foreign, BLIND_PART]);
  expect(wholeCoverage(coverageOf(merged, new Set([30])))).toBeNull();
  // The control: the same reach with no blind part is another fan's loss, and reads whole.
  const sighted = snapshotOf({ ...held, walk: undefined, reach: { complete: false, unreadPeers: [foreign] } });
  expect(wholeCoverage(coverageOf(sighted, new Set([30])))).not.toBeNull();
});
