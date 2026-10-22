// @vitest-environment jsdom
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

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
