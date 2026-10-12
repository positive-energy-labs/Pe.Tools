import { expect, test } from "vite-plus/test";
import {
  FACES,
  WINDOW,
  diameterFor,
  equivalent,
  geometry,
  read,
  rectSides,
} from "./ductulator";

test("one spin lines both laws up on every face: Δp and velocity read straight across from cfm", () => {
  for (const face of Object.values(FACES)) {
    const g = geometry(face);
    for (const [Q, D] of [
      [1000, 12],
      [85, 5],
      [1500, 18],
    ] as const) {
      const { friction, velocity } = read(Q, D);
      const spin = g.spinOf(D);
      expect(g.disk.cfmFriction(Q) + spin).toBeCloseTo(g.base.friction(friction), 6);
      expect(g.disk.cfmVelocity(Q) + spin).toBeCloseTo(g.base.velocity(velocity), 6);
      expect(g.disk.diameter(D) + spin).toBeCloseTo(WINDOW, 6);
    }
  }
});

test("no ring laps itself on either face", () => {
  for (const face of Object.values(FACES)) {
    const g = geometry(face);
    const span = (pitch: number, [lo, hi]: readonly [number, number]) =>
      pitch * Math.log10(hi / lo);
    expect(span(g.pitch.friction, face.range.friction)).toBeLessThan(360);
    expect(span(g.pitch.cfmFriction, face.range.cfmFriction)).toBeLessThan(360);
    expect(span(g.pitch.cfmVelocity, face.range.cfmVelocity)).toBeLessThan(360);
    expect(span(g.pitch.velocity, face.range.velocity)).toBeLessThan(360);
    expect(span(g.pitch.diameter, face.range.diameter)).toBeLessThan(360);
  }
});

test("the law inverts: diameterFor undoes read", () => {
  expect(diameterFor(1000, read(1000, 12).friction)).toBeCloseTo(12, 9);
});

test("rect slots return pairs whose Huebscher equivalent is the set diameter", () => {
  for (const { a, b } of rectSides(12)) expect(equivalent(a, b)).toBeCloseTo(12, 3);
  expect(rectSides(12).find((p) => p.a === 10)?.b).toBeCloseTo(12.1, 1);
});
