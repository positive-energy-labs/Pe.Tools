import { expect, it } from "vite-plus/test";
import raw from "./fixtures/manual-d-20261102.json" with { type: "json" };
import live from "./fixtures/muas-local-20261102.json" with { type: "json" };
import tables from "./fixtures/manual-d-tables.json" with { type: "json" };
import { buildSheet, type SheetSnapshot } from "./build.ts";
import { inputsFor } from "./test-inputs.ts";
import { suggestRoster } from "../roster.ts";
import { toGrids } from "../loss-grid.ts";
import { accessoryWrites } from "./accessory-writes.ts";
// u2-x1, controlled dev, 2026-11-02. Local non-workshared capture after doc save --worksets strip:
// whole fan at 13:35:42 UTC (openId 4aa7f43036de49e2915b37ad52388c9c), accepted join after cold
// restart (openId 456b7bf06d4144049574c8931b72c446). Same saved copy, before any pricing writes.
it.each([raw, live])(
  "tap census retains the controlling path instead of the last visited path",
  (capture) => {
    const snapshot = capture as unknown as SheetSnapshot;
    const r = suggestRoster(snapshot);
    const s = buildSheet({
      snapshot,
      fan: { unitId: 14577391, portIndex: 2 },
      roster: [...r.fans, ...r.suggestions],
      grids: toGrids({ tables }),
      inputs: inputsFor(snapshot, {
        endCfm: { 14577391: 900 },
        drops: { 14577394: 0.0132, 14577396: 0.18, 14088043: 0.026 },
        rulings: [{ pair: ["14106988:1", "14122436:1"], verdict: "accept" }],
      }),
    });
    for (const [id, expected, table] of [[14682361, 0.173027065, "SD5-9"], [14806947, 0.155904829, "SD5-18"]] as const) {
      const row = s.fittings.find((f) => f.elementId === id)!;
      const legs = Object.values(s.legs).filter((l) => l.elementId === id);
      expect(row.lossInWg).toBeCloseTo(Math.max(...legs.map((l) => l.lossInWg ?? 0)), 6);
      expect(row.lossInWg).toBeCloseTo(expected, 6);
      expect(row.table).toBe(table);
      expect(row.derivation).toContain("extrapolated=false");
      expect(row.derivation).toContain("interpolation");
    }
    expect(accessoryWrites(snapshot, s).find((w) => w.id === 14607308)?.inWg).toBeCloseTo(
      0.0322,
      4,
    );
  },
);
