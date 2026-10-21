import { expect, it } from "vitest";

import {
  DEFAULT_DESIGN_FRICTION_RATE,
  rateOf,
  telOf,
  withEquivalentLength,
} from "./equivalent-length.ts";
import type { Row } from "./losses.ts";

const duct = (id: number, lengthFt: number, dp: number): Row => ({
  id,
  kind: "friction",
  dp,
  lengthFt,
  rate: rateOf(dp, lengthFt)!,
  desc: "duct",
});

// The r10 hand check: a fitting of 51.5 ft at 0.013 in-wg/100 ft loses 0.006695; ST-140's typed
// 0.15 in-wg over a duct at 0.0145 in-wg/100 ft is 0.15 / 0.0145 x 100 = 1034.48 ft.
it("reads a fitting and a terminal in feet at the rate of the duct they sit on", () => {
  const rows = withEquivalentLength(
    [
      duct(1, 100, 0.013),
      { id: 2, kind: "fitting", dp: 0.006695, desc: "elbow" },
      duct(3, 50, 0.00725),
      { id: 4, kind: "terminal", dp: 0.15, desc: "ST-140" },
    ],
    DEFAULT_DESIGN_FRICTION_RATE,
  );
  expect(rows.map((r) => r.eqFt!.toFixed(2))).toEqual(["100.00", "51.50", "50.00", "1034.48"]);
  expect(telOf(rows)).toBeCloseTo(100 + 51.5 + 50 + 1034.4828, 3);
});

it("falls to the following duct, then the design rate, and leaves an unpriced row without feet", () => {
  const lead = withEquivalentLength(
    [{ id: 1, kind: "fitting", dp: 0.01, desc: "x" }, duct(2, 100, 0.02)],
    0.08,
  );
  expect(lead[0]!.eqFt).toBeCloseTo(50, 9);
  const alone = withEquivalentLength(
    [
      { id: 1, kind: "terminal", dp: 0.04, desc: "x" },
      { id: 2, kind: "fitting", dp: null, desc: "y" },
    ],
    0.08,
  );
  expect(alone[0]!.eqFt).toBeCloseTo(50, 9);
  expect(alone[1]!.eqFt).toBeNull();
});
