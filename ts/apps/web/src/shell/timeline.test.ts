import { expect, test } from "vite-plus/test";
import { createRouteTimeline, TIMELINE_LIMIT, timelineBarriers } from "./timeline";

test("timeline preserves append order across invocation, receipt and checkpoint, independently of timestamps", () => {
  const timeline = createRouteTimeline();
  timeline.append({
    kind: "invocation",
    at: 30,
    press: "merge-1",
    verb: "merge",
    subject: "room-1",
  });
  timeline.append({
    kind: "receipt",
    at: 10,
    press: "merge-1",
    receiptId: "receipt-1",
    paths: [["marks", "room-1"]],
  });
  timeline.append({
    kind: "checkpoint",
    at: 20,
    basis: { address: "/rooms", readingVersions: { plan: "sha-1" } },
  });
  expect(timeline.read().map(({ kind }) => kind)).toEqual(["invocation", "receipt", "checkpoint"]);
  expect(timeline.read().filter(({ kind }) => kind === "checkpoint")).toEqual([
    {
      kind: "checkpoint",
      at: 20,
      basis: { address: "/rooms", readingVersions: { plan: "sha-1" } },
    },
  ]);
  expect(
    timelineBarriers(timeline.read()).map(({ receiptId, paths }) => ({ receiptId, paths })),
  ).toEqual([{ receiptId: "receipt-1", paths: [["marks", "room-1"]] }]);
});

test("only receipts with nonempty footprints derive barriers; a root path blocks the whole Work", () => {
  expect(
    timelineBarriers([
      { kind: "invocation", at: 1, paths: [["width"]] },
      { kind: "checkpoint", at: 2, paths: [["width"]] },
      { kind: "receipt", at: 3 },
      { kind: "receipt", at: 4, paths: [] },
      { kind: "receipt", at: 5, receiptId: "rebind", paths: [[]] },
    ]),
  ).toEqual([{ kind: "receipt", at: 5, receiptId: "rebind", paths: [[]] }]);
});

test("timeline keeps only the last N entries, delivers all live appends, and unsubscribes", () => {
  const timeline = createRouteTimeline();
  const seen: number[] = [];
  const release = timeline.subscribe(({ at }) => seen.push(Number(at)));
  for (let at = 0; at <= TIMELINE_LIMIT; at++) timeline.append({ kind: "invocation", at });
  expect(timeline.read()).toHaveLength(TIMELINE_LIMIT);
  expect(timeline.read()[0]?.at).toBe(1);
  expect(seen).toHaveLength(TIMELINE_LIMIT + 1);
  release();
  timeline.append({ kind: "invocation", at: TIMELINE_LIMIT + 1 });
  expect(seen).toHaveLength(TIMELINE_LIMIT + 1);
  expect(createRouteTimeline().read()).toEqual([]);
});

test("callers and subscribers cannot mutate recorded timeline evidence", () => {
  const timeline = createRouteTimeline();
  const entry = { kind: "receipt" as const, at: 1, paths: [["width"]] };
  timeline.subscribe((row) => row.paths?.[0]?.push("listener"));
  timeline.append(entry);
  entry.paths[0]!.push("caller");
  timeline.read()[0]!.paths![0]!.push("reader");
  expect(timeline.read()[0]!.paths).toEqual([["width"]]);
});
