import { expect, it } from "vite-plus/test";

import tables from "./fixtures/converging-tables.json" with { type: "json" };
import { GridError, lookupGrid, toGrids } from "./loss-grid.ts";

// Revit's ER5-1, ED5-3 and ED5-4 as the live `ducts.tables` op served them on 2026-10-28 (session
// probe-sheet, dev lane); converging-tables.json is that response's tables, byte for byte.
const grids = toGrids({ tables });
const er51 = grids["ER5-1"]!.Cb!;

it("a three-axis wire narrows to slices, a null row where the table prints none", () => {
  expect(er51).toMatchObject({ xLabel: "Qb/Qc", yLabel: "Ab/Ac", zLabel: "As/Ac" });
  expect(er51.z).toEqual([0.5, 0.75, 1]);
  expect(er51.y).toEqual([0.25, 0.5, 1]);
  expect((er51.grid as (number[] | null)[][])[0]![0]).toBeNull();
  expect(Object.keys(grids["ED5-3"]!)).toEqual(["Cb", "Cs", "Cb#2", "Cs#2"]);
  // A slice of the wrong length, or one stating no row at all, is not a grid.
  const bad = (grid: unknown) => () => toGrids({ tables: { T: { Cb: { ...er51, grid } } } });
  expect(bad([[null, [1], [1]]])).toThrow(GridError);
  expect(bad([[null, null, null], ...(er51.grid as unknown[]).slice(1)])).toThrow(
    "T Cb: grid does not match its axes",
  );
});

it("trilinear: on a node, between slices, and a ragged slice clamped on its own rows", () => {
  // As/Ac 1, Ab/Ac 0.5, Qb/Qc 0.5: the printed 0.45.
  expect(lookupGrid(er51, 0.5, 0.5, 1)).toEqual({
    value: 0.45,
    notes: [],
    inputs: "Qb/Qc=0.5, Ab/Ac=0.5, As/Ac=1",
    at: { x: 0.5, y: 0.5, z: 1 },
  });
  // Halfway between As/Ac 0.75 (0.30) and 1 (0.45).
  expect(lookupGrid(er51, 0.5, 0.5, 0.875).value).toBeCloseTo(0.375, 12);
  // Halfway along every axis of the As/Ac 0.75..1, Ab/Ac 0.5..1, Qb/Qc 0.5..0.6 cell: the mean of
  // its eight corners (0.30 0.42 / 0.00 0.44 at 0.75; 0.45 0.49 / 0.52 0.58 at 1).
  expect(lookupGrid(er51, 0.55, 0.75, 0.875).value).toBeCloseTo(
    (0.3 + 0.42 + 0 + 0.44 + 0.45 + 0.49 + 0.52 + 0.58) / 8,
    12,
  );
  // As/Ac 0.5 prints no Ab/Ac 0.25 row: that slice clamps at its own 0.5 and says so; As/Ac 0.75
  // reads its 0.25 row. At As/Ac 0.625 the point read is Ab/Ac 0.375, the slices' mean.
  const ragged = lookupGrid(er51, 0.5, 0.25, 0.625);
  expect(ragged.value).toBeCloseTo((0 + 0.75) / 2, 12);
  expect(ragged.notes).toEqual(["Ab/Ac clamped at 0.5 (As/Ac 0.5)"]);
  expect(ragged.at).toEqual({ x: 0.5, y: 0.375, z: 0.625 });
});

it("each axis clamps at its edge with a note, and the point read says where", () => {
  // A 4x4 collar on the 32x11 trunk, Ab/Ac 0.045, at Qb/Qc 0.005: every axis past its edge.
  const edge = lookupGrid(er51, 0.005, 0.045, 1.2);
  expect(edge.value).toBe(-444);
  expect(edge.notes).toEqual([
    "As/Ac clamped at 1",
    "Qb/Qc clamped at 0.01",
    "Ab/Ac clamped at 0.25 (As/Ac 1)",
  ]);
  expect(edge.at).toEqual({ x: 0.01, y: 0.25, z: 1 });
});

it("ED5-4 states Ab2/Ac only up to Ab1/Ac; a lookup above it clamps to the slice's last row", () => {
  const ed54 = grids["ED5-4"]!.Cb1!;
  // Ab1/Ac 0.1 states Ab2/Ac 0.01 and 0.1; Ab2/Ac 0.5 reads the 0.1 row (Qb1/Qc 0.5: 0.40).
  const v = lookupGrid(ed54, 0.5, 0.5, 0.1);
  expect(v.value).toBe(0.4);
  expect(v.notes).toEqual(["Ab2/A clamped at 0.1 (Ab1/Ac 0.1)"]);
});

it("a three-axis grid needs all three inputs; a two-axis grid refuses a third", () => {
  expect(() => lookupGrid(er51, 0.5, 0.5)).toThrow("needs As/Ac");
  expect(() => lookupGrid(er51, 0.5, null, 1)).toThrow("needs Ab/Ac");
  const er55 = grids["ER5-5"]!.Cb1!;
  expect(lookupGrid(er55, 1, 1)).toMatchObject({ value: 2, at: { x: 1, y: 1 } });
  expect(() => lookupGrid(er55, 1, 1, 1)).toThrow("takes Qb1/Qc and Ab1/Ac only");
  // One-axis and constant grids keep their shape; the point read is x alone.
  expect(lookupGrid(grids["ER5-2"]!.Cb!, 0.4)).toMatchObject({ value: 0.65, at: { x: 0.4 } });
});
