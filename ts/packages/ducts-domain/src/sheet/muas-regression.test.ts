import { expect, it } from "vite-plus/test";
import raw from "./fixtures/muas-real.json" with { type: "json" };
import type { SheetSnapshot } from "./build.ts";
import { buildSheet } from "./build.ts";
import { inputsFor } from "./test-inputs.ts";
import { suggestRoster } from "../roster.ts";
const snapshot = raw as unknown as SheetSnapshot;
// Retained Chadds topology: .artifacts/tmp/ducts-sheet/chadds-snapshot-health.json,
// reduced to MUAS walked elements and its neighboring units. r52 values and the accepted
// intake join come from .artifacts/tmp/muas900/f1-inputs.json (2026-10-30).
// TODO: Re-drive current Chadds with r52 slots (fan PE_M_Fan_AirFlow, terminal revit:Flow)
// and its accepted intake join before certifying the exact pressure total. K2 geometry differs.
const flows = {
  14577391: 900,
  14088043: 1120,
  6105264: 35,
  6953852: 50,
  6104810: 35,
  12777429: 65,
  12806600: 35,
  13770618: 65,
  13760867: 1200,
};
const joins = [{ pair: ["14106988:1", "14122436:1"] as const, verdict: "accept" as const }];
function replay(restore: boolean) {
  const roster = suggestRoster(snapshot);
  return buildSheet({
    snapshot,
    roster: [...roster.fans, ...roster.suggestions],
    fan: { unitId: 14577391, portIndex: 2 },
    grids: {},
    inputs: inputsFor(snapshot, {
      slot: "revit:Flow",
      rulings: joins,
      endCfm: restore ? flows : { 14577391: 900, 14088043: 1120 },
    }),
  });
}
it("r52 flow inputs, not a graph change, control the MUAS split and shared intake", () => {
  const missing = replay(false),
    restored = replay(true);
  const endFlows = (s: ReturnType<typeof replay>) =>
    Object.fromEntries(s.paths.map((p) => [p.end.elementId, s.legs[p.legIds.at(-1)!]?.flowCfm]));
  expect(endFlows(missing)).toMatchObject({
    6105264: 300,
    6953852: 300,
    13760945: 300,
    14088043: null,
  });
  expect(
    missing.blockers
      .filter((b) => b.kind === "no-flow")
      .map((b) => b.elementId)
      .sort(),
  ).toEqual([6104810, 12777429, 12806600, 13770618].sort());
  expect(endFlows(restored)).toMatchObject({
    6105264: 35,
    6953852: 50,
    13760945: 815,
    14088043: 1100,
  });
  expect(restored.blockers.filter((b) => b.kind === "no-flow")).toEqual([]);
  expect(missing.paths.map((p) => p.end.elementId).sort()).toEqual(
    restored.paths.map((p) => p.end.elementId).sort(),
  );
});
it("silencer and heater are always editable Parts, including before a drop is typed", () => {
  const inputs = inputsFor(snapshot);
  for (const id of ["14577394", "14577396"]) {
    expect(inputs.units[id]).toBeUndefined();
    expect(inputs.components[id]?.drop.value).toBeNull();
  }
  const typed = inputsFor(snapshot, { drops: { 14577394: 0.0132, 14577396: 0.18 } });
  expect(typed.components["14577394"]?.drop.value).toBe(0.0132);
  expect(typed.components["14577396"]?.drop.value).toBe(0.18);
  expect(inputs.units["14577391"]?.kind.value).toBe("muas");
  expect(inputsFor(snapshot, { roles: { 14577396: "fan" } }).units["14577396"]?.role.value).toBe(
    "fan",
  );
});
