// @vitest-environment jsdom
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

test("stagedRoomWrites sends edit values per guid and never a suggestion", () => {
  const doc = roomsRouteState.schema.parse({
    edits: {
      [roomEditKey("a", "name")]: { edit: { value: "Pantry" } },
      [roomEditKey("a", "people")]: { edit: { value: 2 } },
      [roomEditKey("b", "type")]: { edit: { value: "kitchen" } },
      [roomEditKey("b", "role")]: { edit: { value: "zone" } },
      [roomEditKey("b", "ceilingFt")]: { suggestion: { value: 9 } },
      [roomEditKey("c", "name")]: { suggestion: { value: "Pea's idea" } },
    },
  });
  expect(stagedRoomWrites(doc)).toEqual([
    { guid: "a", name: "Pantry", people: 2 },
    { guid: "b", type: "kitchen", role: "zone" },
  ]);
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "role")]: { edit: { value: "held" } } },
    }).success,
  ).toBe(false);
});

test("the Work refuses a value its field does not accept", () => {
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "people")]: { edit: { value: "two" } } },
    }).success,
  ).toBe(false);
  expect(
    roomsRouteState.schema.safeParse({ edits: { '["a"]': { edit: { value: 1 } } } }).success,
  ).toBe(false);
});
