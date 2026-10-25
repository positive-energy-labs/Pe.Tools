import { expect, test } from "vite-plus/test";
import { airTypesOf } from "./air-types.ts";
import type { DuctSnapshot } from "./types.ts";

const snapshot = (
  nodes: Partial<DuctSnapshot["nodes"][number]>[],
  systems: Partial<DuctSnapshot["systems"][number]>[] = [],
) => ({ nodes, systems, segments: [] }) as unknown as DuctSnapshot;

test("classification beats misleading names; FA refines Revit's shared SupplyAir classification", () => {
  const types = airTypesOf(
    snapshot(
      [
        { id: 1, systemName: "RA 1", classification: "Return Air" },
        { id: 2, systemName: "FA 1" },
        { id: 3, systemName: "anything", classification: "Exhaust Air" },
        { id: 4, systemName: "unmapped", classification: "Return Air" },
      ],
      [
        { name: "RA 1", classification: "SupplyAir" },
        { name: "FA 1", classification: "SupplyAir" },
      ],
    ),
  );
  expect([...types.values()]).toEqual(["supply", "fresh", "exhaust", "return"]);
});

test("prefixes are a last resort and mixed equipment never borrows one stream's colour", () => {
  const types = airTypesOf(
    snapshot([
      { id: 1, systemName: "SA 2,EX 3", classification: "Supply Air,Exhaust Air,Power" },
      { id: 2, systemName: "FA 1,SA 2", classification: "Supply Air" },
      { id: 3, systemName: "FL 5" },
      { id: 4, systemName: "SA 9" },
      { id: 5, systemName: "SAMPLE" },
      { id: 6 },
    ]),
  );
  expect([...types.values()]).toEqual([
    "unknown",
    "unknown",
    "exhaust",
    "supply",
    "unknown",
    "unknown",
  ]);
});

test("duplicate names with conflicting classifications stay unknown", () => {
  const types = airTypesOf(
    snapshot(
      [{ id: 1, systemName: "Same" }],
      [
        { name: "Same", classification: "SupplyAir" },
        { name: "Same", classification: "ReturnAir" },
      ],
    ),
  );
  expect(types.get(1)).toBe("unknown");
});
