import { expect, test } from "vite-plus/test";
import { projectTimeline, activityTime, createRouteTimeline, TIMELINE_LIMIT, receiptBarrier, type TimelineVerbs } from "./timeline";

test("activity clocks accept ISO or epoch times, never echo invalid times, and omit negative durations", () => {
  const at = 1793363026741;
  expect(activityTime(at)).toBe(activityTime(new Date(at).toISOString()));
  expect(activityTime(at)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  expect(activityTime(at + 8602, at)).toMatch(/ · 8.6 s$/);
  expect(activityTime(at, at + 1)).toBe(activityTime(at));
  expect(activityTime("invalid 1793363026741")).toBe("Time unavailable");
});

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
    timeline.read().flatMap((entry) => receiptBarrier(entry) ?? []).map(({ receiptId, paths }) => ({ receiptId, paths })),
  ).toEqual([{ receiptId: "receipt-1", paths: [["marks", "room-1"]] }]);
});

test("only receipts with nonempty footprints derive barriers; a root path blocks the whole Work", () => {
  expect(
    [
      { kind: "invocation", at: 1, paths: [["width"]] },
      { kind: "checkpoint", at: 2, paths: [["width"]] },
      { kind: "receipt", at: 3 },
      { kind: "receipt", at: 4, paths: [] },
      { kind: "receipt", at: 5, receiptId: "rebind", paths: [[]] },
    ].flatMap((entry) => receiptBarrier(entry as import("./timeline").TimelineEntry) ?? []),
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

test("a press shows immediately; latest receipt identity and declaration replace its text and consent", () => {
  const timeline = createRouteTimeline();
  const verbs: TimelineVerbs = { start: { kind: "command", label: "Old declaration", does: "old.command" },
    current: { kind: "command", label: "Current declaration", does: "new.command" } };
  timeline.append({ kind: "invocation", at: 1, press: "p", verb: "start", outcome: { id: "p", state: "queued", input: { value: 13 } } });
  timeline.outcome("p", { id: "p", state: "running", input: { value: 13 } });
  expect(timeline.read()).toMatchObject([{ at: 1, press: "p", outcome: { state: "running", input: { value: 13 } } }]);
  expect(projectTimeline(timeline.read(), verbs)).toMatchObject([{ kind: "press", verb: "Old declaration" }]);
  const consentWindow = { requestId: "ask", deadline: "2099-01-01T00:00:00Z" };
  const receipt = (state: "waiting" | "cancelled" | "unknown") => ({
    kind: "receipt" as const, at: 2, press: "p", receiptId: "r", paths: [["width"]],
    // A receipt wins even when earlier presentation and outcome disagree with it.
    verb: "start", outcome: { id: "r", state: "running" as const, input: {} },
    basis: { receipt: { id: "r", key: "new.command", state, input: {}, consentWindow } },
  });
  timeline.append(receipt("waiting"));
  expect(projectTimeline(timeline.read(), verbs)).toMatchObject([
    { kind: "consent", verb: "Current declaration", outcome: { state: "queued" } },
  ]);
  timeline.append(receipt("cancelled"));
  const resolved = projectTimeline(timeline.read(), verbs);
  expect(resolved).toHaveLength(1);
  expect(resolved[0]).toMatchObject({ kind: "receipt", outcome: { state: "cancelled" } });
  expect(resolved[0]?.consentUntil).toBeUndefined();
  expect(resolved[0]?.barrier).toBeUndefined();
  timeline.append(receipt("unknown"));
  expect(projectTimeline(timeline.read(), verbs)[0]).toMatchObject({
    outcome: { state: "outcome-unknown", recovery: "reconcile" }, barrier: { receiptId: "r" },
  });
  verbs.current.label = "Renamed declaration";
  expect(projectTimeline(timeline.read(), verbs)[0]?.verb).toBe("Renamed declaration");
});
