import { takeoffObservationSchema } from "@pe/agent-contracts";
import { snapshotOfObservation } from "./actions";
import { takeoffSeeds as sourceSeeds, DEMO_CANDIDATES } from "./seeds";
export const takeoffSeeds = Object.fromEntries(
  Object.entries(sourceSeeds).map(([name, seed]) => [
    name,
    {
      ...seed,
      page: {
        ...seed.page,
        views: seed.page?.views ?? [],
        zones: seed.page?.zones ?? [],
      },
      queries: {
        "takeoffs.snapshot": seed.readings.snapshot,
        "rhvac.open": { path: "C:/Fixtures/projectA.r10" },
      },
      readings: {
        roster: (() => {
          const world = snapshotOfObservation(
            takeoffObservationSchema.parse(seed.readings.snapshot),
          )?.world;
          return {
            views: (world?.lanes ?? []).map((row) => ({ id: row.view, label: row.label })),
            zones: (world?.zones ?? []).map((row) => ({ id: row.zone.guid, label: row.name })),
            zonesComplete: true,
          };
        })(),
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
