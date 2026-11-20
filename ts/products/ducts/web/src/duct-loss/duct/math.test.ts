import { expect, test } from "vite-plus/test";
import { solve } from "@pe/ducts-domain/duct-loss-math";

const std = { roughness: 0.0003, density: 0.075, length: 100 };

test("12 in round at 1500 fpm lands on the ASHRAE friction chart (~0.27 in. wg/100 ft)", () => {
  const r = solve({ shape: "round", a: 12, b: 0, cfm: 1178, ...std });
  expect(r.velocity).toBeCloseTo(1500, -1);
  expect(r.lossPer100).toBeGreaterThan(0.24);
  expect(r.lossPer100).toBeLessThan(0.3);
  expect(r.loss).toBeCloseTo(r.lossPer100);
});

// A negative flow cannot produce a plausible engineering result (DL-01).
test("invalid duct inputs refuse calculation while zero flow stays finite", () => {
  const duct = { shape: "round" as const, a: 12, b: 8, cfm: 0, ...std };
  expect(Object.values(solve(duct)).every(Number.isFinite)).toBe(true);
  expect(solve(duct).loss).toBe(0);
  for (const patch of [
    { cfm: -100 },
    { a: 0 },
    { density: -1 },
    { length: -1 },
    { roughness: -1 },
    { cfm: Infinity },
  ])
    expect(() => solve({ ...duct, ...patch })).toThrow();
});
