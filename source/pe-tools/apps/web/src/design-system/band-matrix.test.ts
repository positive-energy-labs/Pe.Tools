import { transitionPatches } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

import { reviewTransitions } from "#/components/lang/band";

import {
  applyPatches,
  cellKey,
  MATRIX,
  MATRIX_CELLS,
  PARAMETERS,
  stagePatches,
} from "./band-matrix";
import { matrixWire } from "./band-specimen";

const wire = matrixWire(async () => null);
const kinds = (key: string) => reviewTransitions(wire, key, MATRIX_CELLS[key]!).map((t) => t.kind);

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
  // Families cells take no delete (the ruled cell factory: delete is opt-in, settings only).
  expect(Object.values(MATRIX_CELLS).some((cell) => cell.proposal?.delete)).toBe(false);
});

test("the specimen writes the contract's patches, applied locally", () => {
  const key = cellKey("HP-2", "MOCP");
  const cell = MATRIX_CELLS[key]!;
  const accepted = applyPatches(
    MATRIX_CELLS,
    transitionPatches(["cells"], key, cell, { kind: "accept" }),
  );
  expect(accepted[key]).toMatchObject({ proposal: { value: "25A" }, staged: { value: "25A" } });
  const denied = transitionPatches(["cells"], key, accepted[key]!, { kind: "deny" });
  expect(applyPatches(accepted, denied)[key]?.proposal).toBeNull();
});

test("typing the baseline back stages nothing", () => {
  const key = cellKey("FCU-1", "Weight");
  expect(applyPatches({}, stagePatches({}, key, "88 lb"))[key]?.staged).toBeNull();
  expect(applyPatches({}, stagePatches({}, key, "90 lb"))[key]?.staged).toEqual({ value: "90 lb" });
});
