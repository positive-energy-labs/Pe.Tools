import { openSeeds } from "#/open/graph-seeds";
export const settingsSeeds = Object.fromEntries(
  Object.entries(openSeeds).map(([name, seed]) => [
    name,
    {
      title: seed.title,
      readings: {
        machine: {
          reading: { state: "ready", observation: seed.readings.machine },
          fixture: true,
        },
      },
    },
  ]),
);
