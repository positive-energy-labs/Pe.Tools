import { openSeeds } from "#/open/graph-seeds";
export const settingsSeeds = Object.fromEntries(
  Object.entries(openSeeds).map(([name, seed]) => [
    name,
    {
      title: seed.title,
      readings: { scopes: ["revit", "update", "share", "pea", "host", "notices", "appearance"].map(id => ({ id, label: id })),
        machine: {
          reading: { state: "ready", observation: seed.readings.machine },
          fixture: true,
        },
      },
    },
  ]),
);
