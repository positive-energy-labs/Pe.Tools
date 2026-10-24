import { expect, test } from "vite-plus/test";
import {
  SLOT_CAP,
  SLOT_FLOOR,
  SLOT_POWER,
  notchesFor,
  railLayout,
  slotHeights,
  type Geom,
} from "./scale";

const RAIL = 400;
/** A fixed list of turn heights: a one-liner, prose, a wall of tool output, prose, a one-liner. */
const HEIGHTS = [40, 600, 9000, 300, 60];
const geom: Geom[] = HEIGHTS.reduce<Geom[]>((acc, height, i) => {
  const top = i === 0 ? 0 : acc[i - 1]!.top + acc[i - 1]!.height;
  const step = i === 2 ? 220 : 20; // the wall's 40 blocks run its whole height
  const blocks = [top, ...Array.from({ length: i === 2 ? 40 : 2 }, (_, k) => top + (k + 1) * step)];
  acc.push({ key: `m${i}`, turn: i + 1, top, height, blocks });
  return acc;
}, []);
const DOC = geom.at(-1)!.top + geom.at(-1)!.height;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

test("slots follow px^1.5 between the floor and the cap, and never outgrow the rail", () => {
  expect(SLOT_POWER).toBe(1.5);
  // 1 turn: one capped slot, not the whole rail.
  expect(slotHeights([5000], 696)).toEqual([SLOT_CAP]);
  // 4 turns: the tallest at the cap, the rest by the 1.5 power, short ones on the floor.
  const four = slotHeights([4000, 2000, 1000, 100], 696);
  expect(four[0]).toBe(SLOT_CAP);
  expect(four[1]).toBeCloseTo(SLOT_CAP * 0.5 ** 1.5, 9); // 14.14
  expect(four.slice(2)).toEqual([SLOT_FLOOR, SLOT_FLOOR]);
  expect(sum(four)).toBeLessThan(696 / 4);
  // The fixed list: the wall takes the cap, everything else sits on the floor; 72px of a 400px rail.
  expect(slotHeights(HEIGHTS, RAIL)).toEqual([8, 8, 40, 8, 8]);
  // 60 turns: past the cap's room the scale shrinks to fit the rail, slots between floor and cap
  // keep the 1.5 power exactly.
  const px = Array.from({ length: 60 }, (_, i) => 200 + ((i * 7919) % 5000));
  const sixty = slotHeights(px, 696);
  expect(sum(sixty)).toBeCloseTo(696, 6);
  expect(sum(sixty)).toBeLessThanOrEqual(696);
  expect(sixty.every((h) => h >= SLOT_FLOOR && h <= SLOT_CAP)).toBe(true);
  const free = px.map((p, i) => [p, sixty[i]!] as const).filter(([, h]) => h > SLOT_FLOOR);
  const [p0, h0] = free[0]!;
  for (const [p, h] of free) expect(h / h0).toBeCloseTo((p / p0) ** 1.5, 6);
  // 120 turns: more than the floor allows; equal slots that fill the rail exactly.
  const many = slotHeights(
    Array.from({ length: 120 }, () => 300),
    696,
  );
  expect(sum(many)).toBeCloseTo(696, 6);
  expect(many.every((h) => Math.abs(h - 696 / 120) < 1e-9)).toBe(true);
  expect(slotHeights([], RAIL)).toEqual([]);
});

test("the layout tiles its slots in order", () => {
  const layout = railLayout(geom, DOC, RAIL);
  let cursor = 0;
  for (const g of geom) {
    const box = layout.bands.get(g.key)!;
    expect(box.top).toBeCloseTo(cursor, 6);
    cursor += box.height;
  }
  expect(layout.height).toBeCloseTo(cursor, 6);
  expect(layout.height).toBeLessThanOrEqual(RAIL);
});

test("at and inv invert each other inside every band, and inv clamps", () => {
  const { at, inv, height, bands } = railLayout(geom, DOC, RAIL);
  for (const y of [0, 20, 39, 640, 5000, 9600, DOC - 1]) expect(inv(at(y))).toBeCloseTo(y, 6);
  expect(inv(-50)).toBe(0);
  expect(inv(height + 50)).toBeCloseTo(DOC, 6);
  // A drag through a slot lands proportionally inside that turn.
  const box = bands.get("m2")!;
  const g = geom[2]!;
  expect(inv(box.top + box.height / 2)).toBeCloseTo(g.top + g.height / 2, 6);
});

test("notches at block tops, thinned to the slot, never outside it", () => {
  const { notches, bands } = railLayout(geom, DOC, RAIL);
  for (const g of geom) {
    const ys = notches.get(g.key)!;
    const box = bands.get(g.key)!;
    expect(ys.length).toBeLessThanOrEqual(Math.ceil(box.height / 3));
    expect(ys.length).toBeLessThanOrEqual(g.blocks.length - 1);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(box.height - 2);
    }
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(3);
  }
  // The wall's 40 block tops crowd its 40px slot: they thin, and some remain.
  expect(notches.get("m2")!.length).toBeGreaterThan(3);
  expect(notches.get("m2")!.length).toBeLessThan(40);
  expect(notchesFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7)).toEqual([1, 4]);
  expect(notchesFor([0.2, 2.9], 3)).toEqual([]);
  expect(notchesFor([5, 5.5, 6, 20], 30)).toEqual([5, 20]);
});
