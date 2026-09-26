/**
 * /rooms, deterministic: the write payload, the plan's ink order, callout placement, focus, and
 * the page's defaults.
 */
import { expect, test } from "vite-plus/test";
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";

import { holdsPin, PIN_R, placeCallouts, type CalloutItem } from "./callouts";
import { manifest } from "./manifest";
import {
  fitView,
  focusOf,
  REGION_STATES,
  regionState,
  unassigned,
  WORLD_PX_PER_FT,
  type RoomsRegion,
} from "./plan";
import { roomRows, stagePatches } from "./table";

const region = (patch: Partial<RoomsRegion>): RoomsRegion => ({
  elementId: 1,
  guid: "g1",
  view: "Main Level - Rooms",
  level: "Main Level",
  role: "room",
  zone: "z1",
  designation: null,
  name: "",
  type: "hall",
  ceilingFt: null,
  people: null,
  lightingW: null,
  equipSensible: null,
  equipLatent: null,
  ventilationCfm: null,
  sqft: 100,
  outer: [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
  holes: [],
  label: [5, 5],
  runId: "drawn",
  reason: null,
  touched: false,
  locked: false,
  stale: false,
  ...patch,
});

test("stagedRoomWrites sends staged values per guid and never a proposal", () => {
  const doc = roomsRouteState.schema.parse({
    edits: {
      [roomEditKey("a", "name")]: { staged: { value: "Pantry" } },
      [roomEditKey("a", "people")]: { staged: { value: 2 } },
      [roomEditKey("b", "type")]: { staged: { value: "kitchen" } },
      [roomEditKey("b", "role")]: { staged: { value: "zone" } },
      [roomEditKey("b", "ceilingFt")]: { proposal: { value: 9 } },
      [roomEditKey("c", "name")]: { proposal: { value: "Pea's idea" } },
    },
  });
  expect(stagedRoomWrites(doc)).toEqual([
    { guid: "a", name: "Pantry", people: 2 },
    { guid: "b", type: "kitchen", role: "zone" },
  ]);
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "role")]: { staged: { value: "held" } } },
    }).success,
  ).toBe(false);
});

test("staging a role confirms an inferred designation but not a person's", () => {
  const key = roomEditKey("g1", "role");
  expect(stagePatches({}, region({ designation: "inferred" }), "role", "room")).toEqual([
    { path: ["edits", key, "staged"], value: { value: "room" } },
  ]);
  expect(stagePatches({}, region({ designation: "person" }), "role", "room")).toEqual([
    { path: ["edits", key, "staged"], value: null },
  ]);
});

test("the Work refuses a value its field does not accept", () => {
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "people")]: { staged: { value: "two" } } },
    }).success,
  ).toBe(false);
  expect(
    roomsRouteState.schema.safeParse({ edits: { '["a"]': { staged: { value: 1 } } } }).success,
  ).toBe(false);
});

test("staging what Revit already holds stages nothing", () => {
  const held = region({ people: 2 });
  const key = roomEditKey("g1", "people");
  expect(stagePatches({}, held, "people", 2)).toEqual([
    { path: ["edits", key, "staged"], value: null },
  ]);
  expect(stagePatches({}, held, "people", 3)).toEqual([
    { path: ["edits", key, "staged"], value: { value: 3 } },
  ]);
});

test("the plan inks zone over locked over stale over held over machine", () => {
  expect(REGION_STATES).toEqual(["zone", "locked", "stale", "held", "machine", "unassigned"]);
  expect(regionState(region({ role: "zone", locked: true }))).toBe("zone");
  expect(regionState(region({ locked: true, stale: true, role: "held" }))).toBe("locked");
  expect(regionState(region({ stale: true, role: "held" }))).toBe("stale");
  expect(regionState(region({ role: "held" }))).toBe("held");
  expect(regionState(region({}))).toBe("machine");
  expect(unassigned(region({ zone: null }))).toBe(true);
  expect(unassigned(region({ role: "held", zone: null }))).toBe(false);
  expect(unassigned(region({}))).toBe(false);
});

test("rows put zones first, then their rooms zone by zone, then unassigned rooms, then held", () => {
  const rows = roomRows(
    [
      region({ guid: "h", role: "held", sqft: 500 }),
      region({ guid: "u", zone: null, sqft: 400 }),
      region({ guid: "b1", zone: "zb", sqft: 300 }),
      region({ guid: "a1", zone: "za", sqft: 10 }),
      region({ guid: "zb", role: "zone", zone: null, sqft: 900 }),
      region({ guid: "za", role: "zone", zone: null, sqft: 1000 }),
    ],
    ["Main Level"],
  );
  expect(rows.map((row) => row.region.guid)).toEqual(["za", "zb", "a1", "b1", "u", "h"]);
});

test("rows sort by level order, then area largest first; unnamed regions label R{n}", () => {
  const rows = roomRows(
    [
      region({ guid: "u1", level: "Upper", sqft: 50 }),
      region({ guid: "m1", level: "Main", sqft: 20, name: "Den" }),
      region({ guid: "m2", level: "Main", sqft: 80 }),
    ],
    ["Main", "Upper"],
  );
  expect(rows.map((row) => [row.region.guid, row.label])).toEqual([
    ["m2", "R1"],
    ["m1", "Den"],
    ["u1", "R3"],
  ]);
});

test("focus names rows by the table's labels and says which labels no region wears", () => {
  const rows = roomRows(
    [
      region({ guid: "m1", sqft: 20, name: "Den" }),
      region({ guid: "m2", sqft: 80 }),
      region({ guid: "h", role: "held", sqft: 5 }),
    ],
    ["Main Level"],
  );
  const focus = focusOf(rows, " R1, Den ,R9,R1");
  expect(focus.rows.map((row) => row.region.guid)).toEqual(["m2", "m1"]);
  expect(focus.missing).toEqual(["R9"]);
  expect(focusOf(rows, "").rows).toEqual([]);
});

test("callouts: three small overlapping regions each leave on a leader to a free box", () => {
  const items: CalloutItem[] = [
    { label: "R1", anchor: [200, 150], text: "13 sf", fits: false },
    { label: "R2", anchor: [204, 152], text: "11 sf", fits: false },
    { label: "R3", anchor: [198, 156], text: "5 sf · too-small-under-6sf", fits: false },
  ];
  const placed = placeCallouts(items, { width: 400, height: 300 }, 10);
  expect(placed.map((c) => [c.label, c.pin, c.leader])).toEqual([
    ["R1", [224, 126], true],
    ["R2", [228, 176], true],
    ["R3", [134, 92], true],
  ]);
  for (const [i, a] of placed.entries())
    for (const b of placed.slice(i + 1))
      expect(
        a.box[2] < b.box[0] || a.box[0] > b.box[2] || a.box[3] < b.box[1] || a.box[1] > b.box[3],
      ).toBe(true);
  expect(placeCallouts(items, { width: 400, height: 300 }, 10)).toEqual(placed);
});

test("callouts: a region that fits keeps its pin on its anchor; an off-screen anchor draws none", () => {
  const placed = placeCallouts(
    [
      { label: "Office", anchor: [100, 100], text: "240 sf", fits: true },
      { label: "R9", anchor: [-5, 100], text: "20 sf", fits: true },
    ],
    { width: 400, height: 300 },
    10,
  );
  expect(placed.map((c) => [c.label, c.pin, c.leader])).toEqual([["Office", [100, 100], false]]);
});

test("callouts: a 10 by 10 ft room at 4 px/ft and scale 1.5 holds its own pin", () => {
  const side = 10 * WORLD_PX_PER_FT * 1.5;
  expect(side).toBe(60);
  expect(holdsPin(side, PIN_R)).toBe(true);
  const [pin] = placeCallouts(
    [{ label: "R4", anchor: [250, 390], text: "100 sf", fits: holdsPin(side, PIN_R) }],
    { width: 500, height: 780 },
    PIN_R,
  );
  expect([pin!.pin, pin!.leader]).toEqual([[250, 390], false]);
});

test("fit: Duryee L1's crop on a 500 by 780 pane lets a 60 sf room hold its pin; zoomed out it leaves", () => {
  // w16 vi-duryee registration: 72.96 by 84.72 ft. The world is WORLD_PX_PER_FT exactly, so the
  // fitted box is the crop in feet times that density.
  const crop = {
    w: 39.94513006599976 + 33.01686225247103,
    h: 298.30982822975227 - 213.5918297887348,
  };
  const box = { minX: 0, minY: 0, maxX: crop.w * WORLD_PX_PER_FT, maxY: crop.h * WORLD_PX_PER_FT };
  const { scale } = fitView(box, { width: 500, height: 780 }, 0);
  expect(scale).toBeCloseTo(1.713, 3);
  const room = (s: number): CalloutItem => ({
    label: "R7",
    anchor: [250, 390],
    text: "60 sf",
    fits: holdsPin(6 * WORLD_PX_PER_FT * s, PIN_R), // 6 by 10 ft
  });
  const at = (s: number) => placeCallouts([room(s)], { width: 500, height: 780 }, PIN_R)[0]!;
  expect(at(scale).leader).toBe(false);
  expect(at(scale * 0.3).leader).toBe(true);
});

test("the manifest parses an empty page", () => {
  expect(manifest.page!.parse({})).toEqual({
    stage: "partition",
    view: "",
    selected: [],
    epoch: 0,
  });
  expect(manifest.stages!.map((stage) => stage.key)).toEqual(["partition", "review", "history"]);
});
