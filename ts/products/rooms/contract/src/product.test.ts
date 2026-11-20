import { expect, it } from "vite-plus/test";
import { address, applyPatches, bindWork, message, type RouteStatePatch } from "@pe/agent-contracts";
import { product, ROOM_FIELDS, roomsWork } from "./product.ts";

const FLOOR = "8a0c1e3f-0000-4000-8000-000000000001-000026dc";
const CEILING = "8a0c1e3f-0000-4000-8000-000000000001-0014edcd";
const polygon = [
  [0, 0],
  [1, 0],
  [1, 1],
];
const { commands } = product;

it("a mark names its plan by UniqueId: both authors are refused an ElementId, and a kept mark can be removed", () => {
  const envelope = { version: 1 as const, revision: 0, doc: roomsWork.schema.parse({}) };
  const patch = (value: RouteStatePatch["value"], by: "pea" | "human", from = envelope) =>
    applyPatches(roomsWork, from, by, [{ path: ["marks", "m1"], value }], from.revision);
  const mark = (view: string) => ({ edit: { value: { kind: "reject", view, polygon, runId: "prior" } } });
  for (const by of ["pea", "human"] as const) {
    const refused = patch(mark("9948"), by);
    expect(refused).toMatchObject({ ok: false });
    expect(JSON.stringify(refused)).toContain("Choose a plan view.");
  }
  const kept = patch(mark(FLOOR), "human");
  expect(kept).toMatchObject({
    ok: true,
    envelope: { doc: { marks: { m1: { edit: { value: { view: FLOOR } } } } } },
  });
  if (!kept.ok) throw Error("unreachable");
  expect(patch({ edit: null }, "pea", kept.envelope as typeof envelope)).toMatchObject({ ok: true });
});

it("a partition intent without a plan key stays in Work and is refused before dispatch; two plans of one name are two keys", () => {
  const input = commands["rooms.partition"].authoredInput;
  for (const view of ["", "9948"]) {
    const failed = input.safeParse({ view });
    expect(failed.success).toBe(false);
    expect(message(failed.error!)).toBe("view: Choose a plan view.");
  }
  for (const view of [FLOOR, CEILING]) expect(input.parse({ view })).toEqual({ view });
});

// rooms-draw-baseline 2026-11-16: Pea sent rooms.draw.preview its authored fields and read only
// "(root) has unknown field view, loops, name, role", so it never learned the input lives in Work.
it("a Work command's refusal of authored fields names the writeIntent cell they belong in", () => {
  const failed = commands["rooms.draw.preview"].input.safeParse({
    work: { key: bindWork("rooms", address("C:/Models/rooms.rvt")), revision: 0 },
    view: FLOOR,
    loops: [polygon],
  });
  expect(failed.success).toBe(false);
  expect(message(failed.error!)).toContain('stage writeIntent["rooms.draw"].edit');
});

it("one declaration carries both routes, each with its own Work", () => {
  expect(Object.keys(product.routes)).toEqual(["rooms", "takeoffs"]);
  expect(product.tools.rooms?.work?.route).toBe("rooms");
  expect(product.tools.takeoffs?.work?.route).toBe("takeoffs");
  expect(Object.keys(commands).filter((key) => !key.endsWith(".preview")).sort()).toEqual([
    "rooms.draw",
    "rooms.merge",
    "rooms.partition",
    "takeoffs.adopt",
    "takeoffs.initialize",
    "takeoffs.partition",
    "takeoffs.sync",
  ]);
});

it("the staged room fields are written through the platform sheet pair, never a Rooms command", () => {
  expect(Object.keys(commands)).not.toContain("rooms.write");
  expect(product.sheetWrites).toEqual({ regions: ROOM_FIELDS });
});
