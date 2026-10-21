/**
 * The per-run panel's model: the run of a selected part is the duct at or before it on its priced
 * path, with the parts it feeds up to the next duct, each in equivalent feet at that duct's rate.
 */
import { expect, it } from "vite-plus/test";

import type { Row } from "@pe/ducts-domain/losses";
import type { Priced } from "@pe/ducts-domain/pricing";
import { rateOf, withEquivalentLength } from "@pe/ducts-domain/equivalent-length";

import { runOf } from "./run-detail";

const duct = (id: number, lengthFt: number, dp: number): Row => ({
  id,
  kind: "friction",
  dp,
  lengthFt,
  roughnessFt: 0.0003,
  rate: rateOf(dp, lengthFt)!,
  desc: `duct ${id}`,
});
// The r10 numbers: a 51.5 ft fitting at 0.013 in-wg/100 ft, and ST-140's 0.15 in-wg over 0.0145/100 ft.
const rows = withEquivalentLength(
  [
    duct(1, 100, 0.013),
    { id: 2, kind: "fitting", dp: 0.006695, rule: "elbow-std", desc: "elbow" },
    { id: 3, kind: "fitting", dp: 0.01, desc: "damper, stated drop" },
    duct(4, 50, 0.00725),
    { id: 5, kind: "terminal", dp: 0.15, desc: "ST-140" },
  ],
  0.08,
);
const priced = {
  snapshot: {
    segments: [{ id: 1, size: "12 round", roughness: { valueFt: 0.0003, provenance: "revit-default" } }],
  },
  now: {
    byGroup: { g1: { critical: 5 } },
    paths: { 5: { groupId: "g1", total: 0.17, tel: 0, rows, inferred: [], provisional: null } },
  },
} as unknown as Priced;

it("reads a duct and the fittings it feeds in feet and in-wg, stated drops as additional SP loss", () => {
  const run = runOf(priced, ["g1"], 2)!;
  expect(run.ductId).toBe(1);
  expect(run.lengthFt).toBe(100);
  expect(run.rate).toBeCloseTo(0.013, 9);
  expect(run.roughness).toBe("revit-default");
  expect(run.parts.map((p) => p.id)).toEqual([2, 3]);
  expect(run.parts[0]!.eqFt).toBeCloseTo(51.5, 6);
  expect(run.parts[1]!.stated).toBe(true);
  expect(run.additionalDp).toBeCloseTo(0.01, 9);
});

it("a terminal belongs to the duct feeding it, at that duct's rate", () => {
  const run = runOf(priced, ["g1"], 5)!;
  expect(run.ductId).toBe(4);
  expect(run.parts[0]!.eqFt).toBeCloseTo(1034.48, 2);
  expect(runOf(priced, ["g1"], 99)).toBeNull();
});
