import { expect, it } from "vite-plus/test";
import { builtinCommands as commands } from "../src/semantic-actions.ts";
import { bindWork, message } from "../src/route-state.ts";
import { address } from "../src/target.ts";
import { roomsDocumentSchema } from "../src/rooms.ts";

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
  expect(message(failed.error)).toContain("Choose a plan view");
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
