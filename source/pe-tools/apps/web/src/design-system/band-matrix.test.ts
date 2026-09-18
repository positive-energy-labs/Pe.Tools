import { expect, test } from "vite-plus/test";

import { reviewPatches, reviewTransitions } from "#/components/lang/band";

import {
  applyPatches,
  cellKey,
  LOCKS,
  MATRIX,
  MATRIX_CELLS,
  PARAMETERS,
  stagePatch,
} from "./band-matrix";

const write = async () => null;
const kinds = (key: string) =>
  reviewTransitions("cells", key, MATRIX_CELLS[key]!, write, LOCKS[key] ?? null).map((t) => t.kind);

test("the matrix is 6 families × 3 types × 8 parameters, with the journeys proposal shapes", () => {
  expect(new Set(MATRIX.map((row) => row.family)).size).toBe(6);
  expect(MATRIX.length * PARAMETERS.length).toBe(144);
  const voltage = Object.entries(MATRIX_CELLS).filter(([key]) => key.endsWith("::Voltage"));
  expect(voltage).toHaveLength(12);
  expect(new Set(voltage.map(([, cell]) => cell.proposal?.value))).toEqual(new Set(["208V"]));
  const airflow = Object.entries(MATRIX_CELLS).filter(([key]) => key.endsWith("::Airflow"));
  expect(new Set(airflow.map(([, cell]) => cell.proposal?.value)).size).toBe(9);
  expect(kinds(cellKey("HP-2", "MOCP"))).toEqual(["accept", "deny", "unstage"]);
  expect(kinds(cellKey("AHU-1", "MCA"))).toEqual(["deny"]);
  expect(MATRIX_CELLS[cellKey("UH-3", "Weight")]?.proposal?.delete).toBe(true);
});

test("the specimen writes the same patches a route document takes", () => {
  const key = cellKey("HP-2", "MOCP");
  const patch = reviewPatches("cells");
  const accepted = applyPatches(MATRIX_CELLS, patch.accept(key, MATRIX_CELLS[key]!));
  expect(accepted[key]).toMatchObject({ proposal: { value: "25A" }, staged: { value: "25A" } });
  expect(applyPatches(accepted, patch.deny(key))[key]?.proposal).toBeNull();
  expect(applyPatches(accepted, patch.unstage(key))[key]?.staged).toBeNull();
});

test("typing the baseline back stages nothing", () => {
  const key = cellKey("FCU-1", "Weight");
  expect(stagePatch(key, "88 lb")).toEqual({ path: ["cells", key, "staged"] });
  expect(applyPatches({}, [stagePatch(key, "90 lb")])[key]?.staged).toEqual({ value: "90 lb" });
});
