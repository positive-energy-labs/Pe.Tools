import { expect, test } from "vite-plus/test";
import { budgetBarModel, budgetFillPct } from "../src/workbench/world-cache";

// The budget bar is one linear token scale (tools → system → obs window → msg window). The
// error-prone bits are the fill clamping and the rank→horizon mapping; both are pure here.

const mw = {
  observationThreshold: 200, // msgCap
  reflectionThreshold: 100, // obsCap
  observationTokens: 50,
  messageTokens: 80,
  reflectionFloor: 20,
  observing: false,
  reflecting: false,
} as unknown as Parameters<typeof budgetBarModel>[2];

test("budgetFillPct clamps to [0,100] and guards cap<=0", () => {
  expect(budgetFillPct(50, 100)).toBe(50);
  expect(budgetFillPct(150, 100)).toBe(100); // over cap → clamp high
  expect(budgetFillPct(-5, 100)).toBe(0); // under → clamp low
  expect(budgetFillPct(10, 0)).toBe(0); // divide-by-zero guard
});

test("budgetBarModel maps caps and total in request order", () => {
  const m = budgetBarModel(40, 60, mw, { hasBaseline: false, horizonRank: null });
  expect(m.obsCap).toBe(100); // reflectionThreshold
  expect(m.msgCap).toBe(200); // observationThreshold
  expect(m.total).toBe(400); // 40 + 60 + 100 + 200
  expect(m.horizon).toBeNull(); // no baseline → no horizon
});

test("horizon position tracks the inferred cache-break rank", () => {
  const at = (horizonRank: number) =>
    budgetBarModel(40, 60, mw, { hasBaseline: true, horizonRank }).horizon;
  expect(at(0)).toBe(0); // break before tools → bar start
  expect(at(1)).toBe((40 / 400) * 100); // after tools (system-adjacent)
  expect(at(2)).toBe(((40 + 60 + 100) / 400) * 100); // after the observations window
});

test("total falls back to 1 when every segment is empty", () => {
  const empty = { ...mw, observationThreshold: 0, reflectionThreshold: 0 };
  const m = budgetBarModel(0, 0, empty, { hasBaseline: false, horizonRank: null });
  expect(m.total).toBe(1); // never divide by zero downstream
});
