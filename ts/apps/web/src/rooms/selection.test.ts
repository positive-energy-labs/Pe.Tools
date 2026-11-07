import { expect, test } from "vite-plus/test";
import { roomsAddress } from "../../../../packages/agent-contracts/src/routes/rooms";
import { roomSelection } from "./selection";

const cards = [
  { id: "mark-1", guids: ["room-1", "room-2"] },
  { id: "note-1", guids: [] },
];
test("list and inbox picks share the picture/card projection after a URL round trip", () => {
  const field = roomsAddress.fields.picked;
  for (const ids of [["room-2"], ["card:mark-1"], ["card:note-1"], []]) {
    const restored = field.schema.parse(field.codec.decode(field.codec.encode(ids)));
    expect(roomSelection(restored, cards)).toEqual(roomSelection(ids, cards));
  }
  expect(roomSelection(["room-2"], cards)).toEqual({ pinned: "mark-1", guids: ["room-2"] });
  expect(roomSelection(["card:mark-1"], cards)).toEqual({
    pinned: "mark-1",
    guids: ["room-1", "room-2"],
  });
  expect(roomSelection(["card:note-1"], cards)).toEqual({ pinned: "note-1", guids: [] });
  expect(roomSelection([], cards)).toEqual({ pinned: null, guids: [] });
});

test("all includes current regions without inbox cards", () => {
  expect(roomSelection("all", cards, ["room-3", "room-1"]).guids).toEqual(["room-3", "room-1"]);
});
