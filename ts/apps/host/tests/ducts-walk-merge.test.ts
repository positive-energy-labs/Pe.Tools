import { snapshotOf } from "@pe/ducts-domain/test-snapshot";
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
  expect(mergeSnapshots(snapshotOf({ walk }), snapshotOf()).reach).toEqual({ complete: false, unreadPeers: [] });
});
