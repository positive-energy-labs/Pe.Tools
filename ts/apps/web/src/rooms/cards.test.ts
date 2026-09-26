/**
 * Feedback cards, deterministic: every derived glyph from a hand-made two-run snapshot, and the
 * markdown a person pastes to Claude. Run r1 drew the marks; r2 is the rerun (one region still
 * carries r1 because it was locked). The zone spans everything and must never be matched.
 */
import { expect, test } from "vite-plus/test";
import { roomsRouteState, type Mark } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import { cardsMarkdown, iou, markState, newestRun, type MarkCell } from "./cards";

const VIEW = "L1 - Rooms";
const square = (x: number, y: number, w: number, h = w): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
type Region = RoomsSnapshot.Res.RoomsRegion;
const region = (guid: string, patch: Partial<Region>): Region => ({
  elementId: 1,
  guid,
  view: VIEW,
  level: "L1",
  role: "room",
  zone: "z",
  name: "",
  type: "hall",
  sqft: 100,
  outer: square(0, 0, 10),
  holes: [],
  label: [5, 5],
  runId: "r2",
  touched: false,
  locked: false,
  stale: false,
  ...patch,
});
const snapshot: RoomsSnapshot.Res.Response = {
  levels: [{ name: "L1", elevation: 0, views: [VIEW] }],
  regions: [
    region("z", { role: "zone", zone: null, outer: square(-5, -5, 90, 30), runId: "drawn" }),
    region("kitchen", { name: "Kitchen", outer: square(0, 0, 10) }),
    region("closet", { role: "held", reason: "rejected", outer: square(20, 0, 10) }),
    region("sliver", { role: "held", reason: "sliver", outer: square(40, 0, 10) }),
    region("den", { name: "Den", outer: square(60, 0, 10), runId: "r1", locked: true }),
  ],
};
const mark = (kind: Mark["kind"], polygon: [number, number][], run = "r1"): Mark => ({
  kind,
  anchor: { view: VIEW, level: "L1", polygon },
  run,
});
const staged = (value: Mark): MarkCell => ({ staged: { value } });

test("the newest run is the one most machine regions carry, never drawn or a zone's", () => {
  expect(newestRun(snapshot, VIEW)).toBe("r2");
  expect(newestRun(snapshot, "elsewhere")).toBeNull();
});

test("sampled IoU is near exact on squares and respects holes", () => {
  const room = { outer: square(0, 0, 10), holes: [] };
  expect(iou(square(0, 0, 10), room)).toBeCloseTo(1, 2);
  expect(iou(square(0, 0, 10, 5), room)).toBeCloseTo(0.5, 2);
  expect(iou(square(100, 100, 10), room)).toBe(0);
  expect(iou(square(0, 0, 10), { outer: square(0, 0, 10), holes: [square(0, 0, 5)] })).toBeCloseTo(
    0.75,
    2,
  );
});

test("markState derives every glyph from the rungs and the newest run", () => {
  const states = {
    proposed: markState({ proposal: { value: mark("merge", square(0, 0, 10)) } }, snapshot),
    accepted: markState(staged(mark("merge", square(0, 0, 10), "r2")), snapshot),
    mergePass: markState(staged(mark("merge", square(0, 0, 10))), snapshot),
    mergeOnHeld: markState(staged(mark("merge", square(40, 0, 10))), snapshot),
    rejectPass: markState(staged(mark("reject", square(20, 0, 10))), snapshot),
    rejectWrongReason: markState(staged(mark("reject", square(40, 0, 10))), snapshot),
    rejectOnRoom: markState(staged(mark("reject", square(0, 0, 10))), snapshot),
    wall: markState(staged(mark("wall", square(0, 0, 10))), snapshot),
    split: markState(staged(mark("split", square(60, 0, 10))), snapshot),
    stale: markState(staged(mark("merge", square(0, 0, 10, 4))), snapshot),
    gone: markState(staged(mark("merge", square(0, 0, 10, 1))), snapshot),
    goneOffPlan: markState(staged(mark("reject", square(200, 200, 10))), snapshot),
  };
  expect(states).toEqual({
    proposed: "proposed",
    accepted: "accepted",
    mergePass: "pass",
    mergeOnHeld: "fail",
    rejectPass: "pass",
    rejectWrongReason: "fail",
    rejectOnRoom: "fail",
    wall: "fail",
    split: "fail",
    stale: "stale",
    gone: "gone",
    goneOffPlan: "gone",
  });
});

test("cardsMarkdown renders one section per view, ordered by state then id", () => {
  const doc = roomsRouteState.schema.parse({
    marks: {
      a: staged({ ...mark("merge", square(0, 0, 10)), guids: ["kitchen", "missing"] }),
      b: { proposal: { value: { ...mark("reject", square(20, 0, 10)), note: "a closet" } } },
      c: staged({ ...mark("reject", square(40, 0, 10)), guids: ["sliver"] }),
      d: staged(mark("merge", square(0, 0, 10, 4))),
      e: staged(mark("merge", square(200, 200, 10))),
      f: staged(mark("merge", square(0, 0, 10), "r2")),
      g: staged({
        ...mark("merge", square(0, 0, 5)),
        anchor: { view: "L2 - Rooms", level: "L2", polygon: square(0, 0, 5) },
      }),
    },
    notes: {
      n1: {
        anchor: { view: VIEW, level: "L1", polygon: [[65, 5]] },
        text: "Den is an open plan with the hall",
        by: "person",
        at: "2026-09-25T12:00:00Z",
      },
    },
  });
  expect(cardsMarkdown(doc, snapshot)).toMatchInlineSnapshot(`
    "# Rooms feedback

    ## L1 - Rooms · newest run r2

    - ◆ proposed · reject b · L1 at (25.0, 5.0) ft · 100 sf · run r1 · "a closet"
    - ✗ fail · reject c · L1 at (45.0, 5.0) ft · 100 sf · regions: sliver (held: sliver) · run r1
    - ◐ stale · merge d · L1 at (5.0, 2.0) ft · 40 sf · run r1
    - ⊘ gone · merge e · L1 at (205.0, 205.0) ft · 100 sf · run r1
    - ● accepted · merge f · L1 at (5.0, 5.0) ft · 100 sf · run r2
    - ✓ pass · merge a · L1 at (5.0, 5.0) ft · 100 sf · regions: Kitchen · run r1
    - ✎ note n1 · L1 at (65.0, 5.0) ft · by person 2026-09-25T12:00:00Z · "Den is an open plan with the hall"

    ## L2 - Rooms · newest run none

    - ● accepted · merge g · L2 at (2.5, 2.5) ft · 25 sf · run r1
    "
  `);
  expect(cardsMarkdown(roomsRouteState.schema.parse({}), snapshot)).toBe(
    "# Rooms feedback\n\nNo marks or notes.\n",
  );
});
