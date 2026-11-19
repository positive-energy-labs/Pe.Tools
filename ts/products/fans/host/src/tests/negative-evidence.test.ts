import { expect, test, vi } from "vite-plus/test";
vi.mock("@pe/host/family-actions", () => ({ runPods: vi.fn() }));
import { fanWriteRequest } from "../actions.ts";
import { closedFan, CLOSED_AT } from "./closed-fan.fixture.ts";
import { buildCalc } from "@pe/fans-domain/calc/build";
import { inputsFor } from "@pe/ducts-domain/test-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids, lookupGrid, type Grid } from "@pe/ducts-domain/loss-grid";
import tables from "@pe/ducts-domain/fixtures/manual-d-tables.json" with { type: "json" };
import { ductsPricingData } from "@pe/duct-systems-contract/ducts-read";
import { ductsApplyInputSchema } from "@pe/duct-systems-contract/ducts";

const readSchema = ductsPricingData.shape.calcs.element;
function scenario(coefficient = -0.1) {
  const snapshot = closedFan(100), roster = suggestRoster(snapshot);
  const grids: Record<string, Record<string, Grid>> = structuredClone(toGrids({ tables }));
  // Synthetic signed values on the recorded table's axes, never an extrapolation.
  const grid = grids["CD3-21"]!.Co!;
  const replace = (value: unknown): any => Array.isArray(value) ? value.map(replace) : coefficient;
  grids["CD3-21"] = { Co: { ...grid, grid: replace(grid.grid) } };
  const input = { snapshot, fan: { unitId: 100, portIndex: 0 }, roster: [...roster.fans, ...roster.suggestions], grids,
    inputs: inputsFor(snapshot, { drops: { 3: 0.1, 5: 0.1 } }) };
  const context = { appliedAt: CLOSED_AT, slots: snapshot.slots, peerClaims: new Map(), rulings: {}, storeDeletes: {} };
  return { input, context };
}

test("out-of-table Ab/Ac is unpriced, incomplete and cannot mint", () => {
  const er = toGrids({ tables })["ER5-1"]!.Cb!;
  expect(() => lookupGrid(er, 0.019838809671419714, 0.023366893610756834, 1)).toThrow(/outside/);
  const { input, context } = scenario();
  input.grids["CD3-21"] = { Co: { title: "outside", xLabel: "angle", x: [-2, -1], grid: [0, 0] } };
  const sheet = buildCalc(input);
  expect(Object.values(sheet.legs).find(l => l.elementId === 2)?.evidence.kind).toBe("unpriced");
  expect(sheet.claim.kind).toBe("incomplete");
  expect(() => fanWriteRequest(input, context)).toThrow(/incomplete/);
});

test("read-invalid physical evidence refuses before the native write boundary", () => {
  const { input, context } = scenario(0);
  input.snapshot.segments[0]!.roughness.valueFt = -0.000001;
  const sheet = buildCalc(input);
  expect(readSchema.safeParse(sheet).success).toBe(false);
  expect(sheet.claim.kind).toBe("complete");
  const bridge = { call: vi.fn() }, native = vi.fn();
  const write = () => {
    const minted = fanWriteRequest(input, context);
    bridge.call(minted.request);
    native(minted.request);
  };
  expect(write).toThrow();
  expect(bridge.call).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

test("finite negative in-table coefficient decodes on read and write and lowers loss", () => {
  const coefficient = lookupGrid(toGrids({ tables })["ER5-1"]!.Cb!, 0.4, 1, 1).value;
  expect(coefficient).toBe(-0.25);
  const { input, context } = scenario(coefficient);
  const sheet = buildCalc(input);
  const leg = Object.values(sheet.legs).find(l => l.elementId === 2)!;
  expect(leg.evidence.kind).toBe("coefficient");
  if (leg.evidence.kind !== "coefficient") throw Error("missing coefficient");
  expect(leg.lossInWg).toBeCloseTo(coefficient * leg.evidence.velocityPressureInWg, 6);
  expect(readSchema.safeParse(sheet).success).toBe(true);
  const { claim, request } = fanWriteRequest(input, context);
  expect(ductsApplyInputSchema.safeParse(request).success).toBe(true);
  expect(request.fittings[0]!.coefficient).toBe(coefficient);
  const zero = scenario(0);
  expect(claim.requiredEspInWg).toBeLessThan(fanWriteRequest(zero.input, zero.context).claim.requiredEspInWg);
});
