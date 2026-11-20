import { expect, it } from "vite-plus/test";
import { builtinCommands as commands } from "../src/semantic-actions.ts";
import { bindWork, message, type RouteStatePatch } from "../src/route-state.ts";
import { applyPatches } from "../src/route-doc.ts";
import { address } from "../src/target.ts";
import { roomsDocumentSchema, roomsRouteState } from "../src/rooms.ts";

it("keeps saved unbound marks editable and refuses newly authored plan names", () => {
  const mark = {
    kind: "reject",
    anchor: {
      view: "L2",
      level: "Level 2",
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    },
    run: "prior",
  };
  const doc = roomsDocumentSchema.parse({
    marks: { old: { edit: { by: "human", value: mark } } },
  });
  const envelope = { version: 1 as const, revision: 0, doc };
  const patch = (path: string[], value: RouteStatePatch["value"], by: "pea" | "human" = "pea") =>
    applyPatches(roomsRouteState, envelope, by, [{ path, value }], 0);
  expect(doc.marks.old?.edit?.value.anchor.view).toBeNull();
  expect(patch(["marks", "new"], { edit: { value: mark } })).toMatchObject({
    ok: false,
    error: "Choose a plan view by its Revit view id.",
  });
  expect(patch(["marks", "old", "edit", "value", "anchor", "view"], "L2")).toMatchObject({
    ok: false,
  });
  expect(patch(["marks", "new"], { edit: { value: mark } }, "human")).toMatchObject({
    ok: false,
    error: "Choose a plan view.",
  });
  expect(patch(["marks", "old", "edit", "value", "anchor", "view"], 9948)).toMatchObject({
    ok: true,
    envelope: { doc: { marks: { old: { edit: { value: { anchor: { view: 9948 } } } } } } },
  });
  expect(patch(["marks", "old"], { edit: null })).toMatchObject({ ok: true });
});

it("a name-only Rooms intent stays editable but asks for a plan id before dispatch", () => {
  const work = roomsDocumentSchema.parse({
    writeIntent: { "rooms.partition": { edit: { by: "human", value: { view: "L2" } } } },
    marks: {
      old: {
        edit: {
          by: "human",
          value: {
            kind: "reject",
            run: "prior",
            anchor: {
              view: "L2",
              level: "Level 2",
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            },
          },
        },
      },
    },
  });
  const input = commands["rooms.partition"].authoredInput;
  const failed = input.safeParse(work.writeIntent?.["rooms.partition"]?.edit?.value);
  expect(failed.success).toBe(false);
  expect(message(failed.error)).toBe("view: Choose a plan view.");
  expect(work.marks.old?.edit?.value.anchor.view).toBeNull();
  for (const view of [9948, 1371629]) expect(input.parse({ view })).toEqual({ view });
});

// rooms-draw-baseline 2026-11-16: Pea sent rooms.draw.preview its authored fields and read only
// "(root) has unknown field view, loops, name, role", so it never learned the input lives in Work.
it("a Work command's refusal of authored fields names the writeIntent cell they belong in", () => {
  const failed = commands["rooms.draw.preview"].input.safeParse({
    work: { key: bindWork("rooms", address("C:/Models/rooms.rvt")), revision: 0 },
    view: "Level 1",
    loops: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ],
  });
  expect(failed.success).toBe(false);
  expect(message(failed.error)).toContain('stage writeIntent["rooms.draw"].edit');
});
