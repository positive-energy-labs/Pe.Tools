import { expect, test } from "vite-plus/test";
import { READING_MAX_FRAME_BYTES, bindWork, familiesRouteState, familiesObservationSchema } from "@pe/agent-contracts";
import recorded from "../../../host/tests/native-recordings/retained-families-final.json";
import { familiesValue } from "./host.ts";

/*
 * gate-1ebf1fb1: Air Terminals on Chadds-r1 read 37 matrix batches, 4.1 MB of native responses
 * (revit.log.txt, 04:36 to 04:38), and the families value failed its frame: "Resource value
 * exceeds the frame limit". The recorded matrix here is scaled to that size from real records.
 */
const scaled = (bytes: number) => {
  const [family] = recorded.families;
  const types = Array.from({ length: 24 }, (_, i) => `${family!.typeNames[i % family!.typeNames.length]} ${i}`);
  const one = (n: number) => ({
    ...family!,
    familyId: n,
    familyUniqueId: `${family!.familyUniqueId}-${n}`,
    familyName: `${family!.familyName} ${n}`,
    typeNames: types,
    parameters: family!.parameters.map((p) => ({
      ...p,
      valuesPerType: Object.fromEntries(types.map((t, i) => [t, Object.values(p.valuesPerType)[i % 4] ?? null])),
    })),
  });
  const families = [];
  while (JSON.stringify(families).length < bytes) families.push(one(families.length));
  return { ...recorded, families };
};

test("an Air Terminals read the size of gate-1ebf1fb1's (4.1 MB native) publishes a families value that fits one reading frame", () => {
  const result = scaled(4_100_000);
  const work = familiesRouteState.schema.parse({});
  const observation = familiesObservationSchema.parse({
    id: "read-1", work: bindWork("families", null, "doc-a"), document: { session: "s", openId: "project" },
    filter: { categoryNames: ["Air Terminals"], familyNames: [], placementScope: "AllLoaded" },
    capturedAt: work.takenAt ?? "2026-11-11T10:36:35.000Z", completedAt: "2026-11-11T10:37:40.000Z", result,
  });
  const catalog = { summary: { totalFamilies: 0, placedFamilies: 0, unplacedFamilies: 0, totalTypes: 0, totalPlacedInstances: 0, truncated: false }, families: [], issues: [] };
  const value = familiesValue({ work, catalog, observation, receipts: [] });
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  // ponytail: one frame bounds the read near 6.5 MB of native matrix; window rows by family past that.
  const parts = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, JSON.stringify(v ?? null).length]));
  expect(JSON.stringify(result.families).length).toBeGreaterThanOrEqual(4_100_000);
  expect(bytes, JSON.stringify(parts)).toBeLessThanOrEqual(READING_MAX_FRAME_BYTES);
});
