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
