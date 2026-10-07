import { expect, test } from "vite-plus/test";
import { solve } from "./math";

const std = { roughness: 0.0003, density: 0.075, length: 100 };

test("12 in round at 1500 fpm lands on the ASHRAE friction chart (~0.27 in. wg/100 ft)", () => {
  const r = solve({ shape: "round", a: 12, b: 0, cfm: 1178, ...std });
  expect(r.velocity).toBeCloseTo(1500, -1);
  expect(r.lossPer100).toBeGreaterThan(0.24);
  expect(r.lossPer100).toBeLessThan(0.3);
  expect(r.loss).toBeCloseTo(r.lossPer100);
});

test("rectangular: hydraulic and Huebscher equivalent diameters", () => {
  const r = solve({ shape: "rect", a: 12, b: 12, cfm: 1000, ...std });
  expect(r.hydraulicDiameter).toBeCloseTo(12);
  expect(r.equivalentDiameter).toBeCloseTo(13.1, 1);
  expect(solve({ shape: "rect", a: 24, b: 6, cfm: 1000, ...std }).hydraulicDiameter).toBeCloseTo(9.6);
});

test("zero flow is zero loss, not NaN", () => {
  expect(solve({ shape: "round", a: 12, b: 0, cfm: 0, ...std }).loss).toBe(0);
});
