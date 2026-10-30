import { BAY_RECENTS, BAY_THREADS, MACHINE_SEEDS, OPEN_SEEDS } from "./seeds";
export const openSeeds = {
  refresh: {
    ...OPEN_SEEDS.refresh,
    readings: { ...OPEN_SEEDS.refresh.readings, threads: BAY_THREADS, receipts: [], world: [] },
  },
  ...Object.fromEntries(
    Object.entries(MACHINE_SEEDS).map(([name, reading]) => [
      name,
      {
        title: name,
        readings: {
          machine:
            "observation" in reading
              ? reading.observation
              : "previous" in reading
                ? reading.previous
                : null,
          recents: BAY_RECENTS,
          threads: BAY_THREADS,
          receipts: [],
          world: [],
        },
      },
    ]),
  ),
};
