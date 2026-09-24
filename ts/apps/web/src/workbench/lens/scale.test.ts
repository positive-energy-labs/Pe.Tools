import { expect, test } from "vite-plus/test";
import { MIN_BAND, SCALE, railLayout } from "./scale";

test("inflated bands stack in order and the window maps through them", () => {
  // Two short turns (would draw 1px at SCALE) then a long one.
  const geom = [
    { key: "a", turn: 1, top: 0, height: 20 },
    { key: "b", turn: 1, top: 20, height: 20 },
    { key: "c", turn: 2, top: 40, height: 2000 },
  ];
  const { bands, at } = railLayout(geom, 2040, 800);
  expect(bands.get("a")).toEqual({ top: 0, height: MIN_BAND });
  expect(bands.get("b")!.top).toBe(MIN_BAND);
  expect(bands.get("c")!.top).toBe(2 * MIN_BAND);
  expect(bands.get("c")!.height).toBeCloseTo(2000 * SCALE);
  // A viewport on turn b maps inside b's band, not onto the proportional 1px.
  expect(at(30)).toBeCloseTo(MIN_BAND * 1.5);
  expect(at(40)).toBeCloseTo(2 * MIN_BAND);
});

test("a thread too long for the rail shrinks to fit", () => {
  const geom = Array.from({ length: 200 }, (_, i) => ({
    key: `${i}`,
    turn: i,
    top: i * 50,
    height: 50,
  }));
  const { bands, at } = railLayout(geom, 10000, 400);
  const last = bands.get("199")!;
  expect(last.top + last.height).toBeLessThanOrEqual(400.01);
  expect(at(10000)).toBeLessThanOrEqual(400.01);
});
