/** /rooms, deterministic: the write payload, the plan's ink order, and the page's defaults. */
import { expect, test } from "vite-plus/test";
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";

import { manifest } from "./manifest";
import { REGION_STATES, regionState, unassigned, type RoomsRegion } from "./plan";
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

test("the manifest parses an empty page", () => {
  expect(manifest.page!.parse({})).toEqual({
    stage: "partition",
    view: "",
    selected: [],
    epoch: 0,
  });
  expect(manifest.stages!.map((stage) => stage.key)).toEqual(["partition", "review", "history"]);
});
