import { expect, it } from "vite-plus/test";
import { BLIND_PART, mergeSnapshots } from "./system-reads.ts";
import { snapshotOf } from "./test-snapshot.ts";

it("a merge keeps every part's lost coverage: only the second part damaged (P-021)", () => {
  const walk = {
    startId: 1,
    hops: 1,
    elementsReached: 1,
    openEnds: 0,
    candidates: [],
    elapsedMs: 1,
  };
  const peer = { elementId: 7, connector: 1 };
  const whole = snapshotOf({
    walk: { ...walk, truncated: false, unreadPeers: [] },
    reach: { complete: true, unreadPeers: [] },
  });
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

it("a merge never drops a part that carries no coverage evidence, and keeps every walk's candidates and counts (P-033)", () => {
  const walk = {
    startId: 1,
    hops: 2,
    elementsReached: 3,
    openEnds: 1,
    truncated: false,
    elapsedMs: 1,
    unreadPeers: [],
  };
  const end = (elementId: number) => ({
    elementId,
    connector: 0,
    point: [0, 0, 0],
    candidateCount: 0,
    candidateIds: [],
  });
  const first = snapshotOf({ walk: { ...walk, candidates: [end(5)] } });
  const second = snapshotOf({ walk: { ...walk, startId: 9, candidates: [end(6)] } });
  expect(mergeSnapshots([first, second])!.walk).toMatchObject({
    startId: 9,
    hops: 4,
    elementsReached: 6,
    openEnds: 2,
    candidates: [end(5), end(6)],
  });
  for (const parts of [
    [first, snapshotOf()],
    [snapshotOf(), first],
  ])
    expect(mergeSnapshots(parts)!.reach).toEqual({ complete: false, unreadPeers: [BLIND_PART] });
});
