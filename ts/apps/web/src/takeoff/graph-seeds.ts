import { takeoffSeeds as sourceSeeds, DEMO_CANDIDATES } from "./seeds";
export const takeoffSeeds = Object.fromEntries(
  Object.entries(sourceSeeds).map(([name, seed]) => [
    name,
    {
      ...seed,
      queries: {
        "takeoffs.snapshot": seed.readings.snapshot,
        "rhvac.open": { path: "C:/Fixtures/projectA.r10" },
      },
      readings: {
        candidates: DEMO_CANDIDATES,
        ownerCrops: null,
        plan: null,
        rhvacVersion: null,
        receipts: [],
        captures: [],
        saved: null,
        text: null,
        ...seed.readings,
      },
    },
  ]),
);
