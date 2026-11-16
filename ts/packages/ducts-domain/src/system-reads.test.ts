import { expect, it } from "vite-plus/test";
import { mergeSnapshots } from "./system-reads.ts";
import { snapshotOf } from "./test-snapshot.ts";

it("a merge keeps every part's lost coverage: only the second part damaged (P-021)", () => {
  const walk = { startId: 1, hops: 1, elementsReached: 1, openEnds: 0, candidates: [], elapsedMs: 1 };
  const peer = { elementId: 7, connector: 1 };
  const whole = snapshotOf({ walk: { ...walk, truncated: false, unreadPeers: [] }, reach: { complete: true, unreadPeers: [] } });
  const damaged = snapshotOf({
    walk: { ...walk, truncated: true, unreadPeers: [peer] },
    reach: { complete: false, unreadPeers: [peer] },
  });
  for (const parts of [
    [whole, damaged],
    [damaged, whole],
  ]) {
    const merged = mergeSnapshots(parts)!;
    expect(merged.walk).toMatchObject({ truncated: true, unreadPeers: [peer] });
    expect(merged.reach).toEqual({ complete: false, unreadPeers: [peer] });
  }
  expect(mergeSnapshots([whole, whole])!.reach).toEqual({ complete: true, unreadPeers: [] });
});
