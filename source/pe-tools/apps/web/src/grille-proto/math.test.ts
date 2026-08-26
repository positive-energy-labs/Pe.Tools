import { describe, expect, it } from "vite-plus/test";

import { SHEET_ROWS, frac, ribToFill, solve } from "./math";

// Values read off the spreadsheet's evaluated cells (row 7 and row 10).
describe("grille math matches the xlsx", () => {
  it("row 7: 3 × 3/4 openings, 5/8 ribs", () => {
    const g = solve(SHEET_ROWS[0]!);
    expect(g.middleAvailable).toBeCloseTo(3.5);
    expect(g.openingLength).toBeCloseTo(16.5);
    expect(g.ribs).toBe(2);
    expect(g.middleDimension).toBeCloseTo(3.5);
    expect(g.freeAreaBeforeDerate).toBeCloseTo(0.45);
    expect(g.lengthDerate).toBeCloseTo(16.5 / 18);
    expect(g.freeArea).toBeCloseTo(0.4125);
    expect(g.actualFreeArea).toBeCloseTo(37.125);
  });
  it("row 10: 5 × 1/2 openings, 3/8 ribs, 1/2 edge", () => {
    const g = solve(SHEET_ROWS[3]!);
    expect(g.middleDimension).toBeCloseTo(4);
    expect(g.slack).toBeCloseTo(0);
    expect(g.freeArea).toBeCloseTo(0.5 * (16.5 / 18));
  });
  it("ribToFill recovers the sheet's derived rib widths", () => {
    expect(ribToFill(SHEET_ROWS[2]!)).toBeCloseTo(0.4166666);
    expect(ribToFill(SHEET_ROWS[4]!)).toBeCloseTo(0.40625);
  });
  it("frac", () => {
    expect(frac(0.625)).toBe("5/8");
    expect(frac(1.5)).toBe("1 1/2");
    expect(frac(18)).toBe("18");
  });
});
