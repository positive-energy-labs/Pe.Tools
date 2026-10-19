import { expect, test } from "vite-plus/test";

import { lookupGrid } from "./loss-grid.ts";
import { LOSS_RULES, type FittingFacts } from "./loss-rules.ts";

const rect = (w: number, h: number) => ({
  shape: "rectangular",
  section: { areaFt2: (w * h) / 144, dhIn: (2 * w * h) / (w + h) },
  widthIn: w,
  heightIn: h,
});
const facts = (family: string, partType: string, out = rect(18, 19.25)): FittingFacts => ({
  kind: "fitting",
  family,
  partType,
  rOverD: null,
  aoOverA1: out.section.areaFt2 / rect(18, 19.25).section.areaFt2,
  angleDeg: partType === "Elbow" ? 90 : 60,
  inlet: rect(18, 19.25),
  outlet: out,
  main: null,
  abOverAc: null,
  takeoff: false,
});
const match = (f: FittingFacts) => LOSS_RULES.find((r) => r.when(f, { q: 1200 }))?.key;

test("rectangular mitered elbows and transitions find their ASHRAE rule", () => {
  const plain = facts("Rectangular Elbow - Mitered", "Elbow");
  expect(match(plain)).toBe("elbow-mitered");
  expect(match(facts("Rectangular Elbow - Mitered - Double Thickness Vanes", "Elbow"))).toBe(
    "elbow-mitered-vaned",
  );
  expect(match(facts("Rectangular Transition - Angle", "Transition", rect(45, 8)))).toBe("trx-rect");

  // CR3-6 rows at H/W 1.00 and 1.50: 90 deg reads 1.18 and 1.13.
  const cr36 = {
    title: "CR3-6",
    xLabel: "H/W",
    x: [1, 1.5],
    yLabel: "Theta",
    y: [60, 90],
    grid: [
      [0.55, 0.52],
      [1.18, 1.13],
    ],
  };
  const input = LOSS_RULES.find((r) => r.key === "elbow-mitered")!.input(plain, { q: 1200 }, "CR3-6", "C");
  expect(lookupGrid(cr36, input.x, input.y).value).toBeCloseTo(1.18 - (19.25 / 18 - 1) * 0.1, 4);
});
