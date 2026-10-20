import { expect, test } from "vite-plus/test";
import { MAX_BAND, MIN_BAND, bandHeight, railLayout } from "./scale";

test("band height grows with the log of a turn's length and stops at the cap", () => {
  expect(bandHeight(0)).toBe(MIN_BAND);
  expect(bandHeight(200)).toBeGreaterThan(bandHeight(20));
  // Ten times longer is nowhere near ten times taller.
  expect(bandHeight(2000) / bandHeight(200)).toBeLessThan(2);
  expect(bandHeight(1e7)).toBe(MAX_BAND);
});

test("bands tile the document, and the map is continuous across them", () => {
  const geom = [
    { key: "a", turn: 1, top: 8, height: 20 },
    { key: "b", turn: 1, top: 40, height: 400 },
    { key: "c", turn: 2, top: 460, height: 2000 },
  ];
  const { bands, at, height } = railLayout(geom, 2470, 800);
  const a = bands.get("a")!;
  const b = bands.get("b")!;
  const c = bands.get("c")!;
  expect(a.top).toBe(0);
  expect(b.top).toBeCloseTo(a.height);
  expect(c.top).toBeCloseTo(b.top + b.height);
  expect(height).toBeCloseTo(c.top + c.height);
  // Each band's doc range lands exactly on its box; no jump at a seam.
  expect(at(0)).toBe(0);
  expect(at(40)).toBeCloseTo(b.top);
  expect(at(460 - 0.001)).toBeCloseTo(c.top, 2);
  expect(at(2470)).toBeCloseTo(height);
  // Monotonic: scrolling down never moves the thumb up.
  let last = -1;
  for (let y = 0; y <= 2470; y += 13) {
    expect(at(y)).toBeGreaterThanOrEqual(last);
    last = at(y);
  }
});

test("a thread too long for the rail shrinks to fit", () => {
  const geom = Array.from({ length: 200 }, (_, i) => ({
    key: `${i}`,
    turn: i,
    top: i * 50,
    height: 50,
  }));
  const { bands, at, height } = railLayout(geom, 10000, 400);
  const last = bands.get("199")!;
  expect(last.top + last.height).toBeCloseTo(400);
  expect(height).toBeCloseTo(400);
  expect(at(10000)).toBeCloseTo(400);
});

test("a short thread draws at its natural size, shorter than the rail", () => {
  const { height } = railLayout([{ key: "a", turn: 1, top: 0, height: 1000 }], 1000, 800);
  expect(height).toBeCloseTo(bandHeight(1000));
});
