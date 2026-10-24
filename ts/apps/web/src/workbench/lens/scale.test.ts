import { expect, test } from "vite-plus/test";
import {
  LENS_VARIANTS,
  SLOT_FLOOR,
  fill,
  notchesFor,
  railLayout,
  type Geom,
  type LensVariant,
} from "./scale";

const RAIL = 400;
/** A fixed list of turn heights: a one-liner, prose, a wall of tool output, prose, a one-liner. */
const HEIGHTS = [40, 600, 9000, 300, 60];
const geom: Geom[] = HEIGHTS.reduce<Geom[]>((acc, height, i) => {
  const top = i === 0 ? 0 : acc[i - 1]!.top + acc[i - 1]!.height;
  const blocks = [top, ...Array.from({ length: i === 2 ? 40 : 2 }, (_, k) => top + (k + 1) * 20)];
  acc.push({ key: `m${i}`, turn: i + 1, top, height, blocks });
  return acc;
}, []);
const DOC = geom.at(-1)!.top + geom.at(-1)!.height;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const heightsOf = (variant: LensVariant) =>
  geom.map((g) => railLayout(geom, DOC, RAIL, variant).bands.get(g.key)!.height);

test("fill: proportional, floored, sums to the rail, keeps order", () => {
  const h = fill([1, 50, 1000, 5], RAIL, SLOT_FLOOR);
  expect(sum(h)).toBeCloseTo(RAIL, 6);
  expect(h.every((x) => x >= SLOT_FLOOR)).toBe(true);
  expect(h[2]).toBeGreaterThan(h[1]!);
  expect(h[1]).toBeGreaterThan(h[0]!);
  // The two under the floor sit exactly on it.
  expect(h[0]).toBe(SLOT_FLOOR);
  expect(h[3]).toBe(SLOT_FLOOR);
  // Too many slots for the floor: equal slots, still the rail.
  const many = fill(new Array(100).fill(1), RAIL, SLOT_FLOOR);
  expect(sum(many)).toBeCloseTo(RAIL, 6);
  expect(many.every((x) => Math.abs(x - RAIL / 100) < 1e-9)).toBe(true);
  expect(fill([], RAIL, SLOT_FLOOR)).toEqual([]);
});

test.each(LENS_VARIANTS.filter((v) => v !== "today"))("%s fills the rail, in order", (variant) => {
  const layout = railLayout(geom, DOC, RAIL, variant);
  expect(layout.height).toBeCloseTo(RAIL, 6);
  let cursor = 0;
  for (const g of geom) {
    const box = layout.bands.get(g.key)!;
    expect(box.top).toBeCloseTo(cursor, 6);
    cursor += box.height;
  }
  const floor = variant === "share" ? 2 : SLOT_FLOOR;
  expect(heightsOf(variant).every((h) => h >= floor - 1e-9)).toBe(true);
});

test("today keeps its log rule: stack under the rail, 3..24px bands", () => {
  const layout = railLayout(geom, DOC, RAIL, "today");
  expect(layout.height).toBeLessThanOrEqual(RAIL);
  for (const h of heightsOf("today")) {
    expect(h).toBeGreaterThanOrEqual(3);
    expect(h).toBeLessThanOrEqual(24);
  }
});

test("the rules differ where they should", () => {
  const share = heightsOf("share");
  const sqrt = heightsOf("sqrt");
  const blocks = heightsOf("blocks");
  // share: the 9000px wall takes its full linear share, about 90% of the rail.
  expect(share[2]! / RAIL).toBeGreaterThan(0.85);
  // sqrt: the wall is tamed; the prose turns are visible slots.
  expect(sqrt[2]! / RAIL).toBeLessThan(0.65);
  expect(sqrt[1]).toBeGreaterThan(SLOT_FLOOR * 2);
  // blocks: 41 blocks vs 3 — proportional to count, not pixels.
  expect(blocks[2]! / blocks[1]!).toBeCloseTo(41 / 3, 1);
  // marks sizes exactly as sqrt.
  expect(heightsOf("marks")).toEqual(sqrt);
});

test("at and inv invert each other inside every band, and inv clamps", () => {
  for (const variant of LENS_VARIANTS) {
    const { at, inv, height } = railLayout(geom, DOC, RAIL, variant);
    for (const y of [0, 20, 39, 640, 5000, 9600, DOC - 1]) expect(inv(at(y))).toBeCloseTo(y, 6);
    expect(inv(-50)).toBe(0);
    expect(inv(height + 50)).toBeCloseTo(DOC, 6);
    // A drag through a slot lands proportionally inside that turn.
    const box = railLayout(geom, DOC, RAIL, variant).bands.get("m2")!;
    const g = geom[2]!;
    expect(inv(box.top + box.height / 2)).toBeCloseTo(g.top + g.height / 2, 6);
  }
});

test("marks: notches at block tops, thinned to the slot, never outside it", () => {
  const { notches, bands } = railLayout(geom, DOC, RAIL, "marks");
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
  // The wall has 40 block tops in its first 800px: more than that stretch of slot can hold, so they
  // thin, and still some remain.
  expect(notches.get("m2")!.length).toBeGreaterThan(3);
  expect(notches.get("m2")!.length).toBeLessThan(40);
  expect(railLayout(geom, DOC, RAIL, "sqrt").notches.size).toBe(0);
  expect(notchesFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7)).toEqual([1, 4]);
  expect(notchesFor([0.2, 2.9], 3)).toEqual([]);
  expect(notchesFor([5, 5.5, 6, 20], 30)).toEqual([5, 20]);
});
