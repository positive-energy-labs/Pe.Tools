import { expect, it } from "vite-plus/test";
import { commands } from "../src/semantic-actions.ts";
import { bindWork, message } from "../src/route-state.ts";
import { address } from "../src/target.ts";

// rooms-draw-baseline 2026-11-16: Pea sent rooms.draw.preview its authored fields and read only
// "(root) has unknown field view, loops, name, role", so it never learned the input lives in Work.
it("a Work command's refusal of authored fields names the writeIntent cell they belong in", () => {
  const failed = commands["rooms.draw.preview"].input.safeParse({
    work: { key: bindWork("rooms", address("C:/Models/rooms.rvt")), revision: 0 },
    view: "Level 1",
    loops: [[[0, 0], [1, 0], [1, 1]]],
  });
  expect(failed.success).toBe(false);
  expect(message(failed.error)).toContain('stage writeIntent["rooms.draw"].edit');
});
