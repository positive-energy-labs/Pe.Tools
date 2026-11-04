import { z } from "zod";
import { takeoffBase, atlasLayout } from "../takeoff/graph";
export const rhvacSyncGraph = {
  ...takeoffBase,
  key: "rhvac-sync",
  address: "rhvac-sync",
  name: "RHVAC sync",
  directory: {
    ...takeoffBase.directory!,
    path: "/rhvac-sync",
    title: "RHVAC sync",
    blurb: "Sync selected zones to one RHVAC file.",
  },
  seeds: Object.fromEntries(
    Object.entries(takeoffBase.seeds!).map(([id, seed]) => [
      id,
      {
        ...seed,
        load: async () => {
          const data = await seed.load();
          return { ...data, page: { ...data.page, stage: "sync" as const } };
        },
      },
    ]),
  ),
  subjectField: {
    field: "r10" as const,
    noun: "RHVAC file",
    keyKind: "name" as const,
    cardinality: "one" as const,
    roster: "captures",
    detail: "rhvacVersion",
    pane: "scope",
    show: (id: string) => id,
  },
  subject: (p: import("../takeoff/graph").TakeoffGraphPage) => p.r10 || "Choose an RHVAC file",
  fields: {
    ...takeoffBase.fields,
    views: { ...takeoffBase.fields.views, role: "query" as const },
    r10: { ...takeoffBase.fields.r10, role: "subject" as const },
    stage: { ...takeoffBase.fields.stage, schema: z.literal("sync").default("sync") },
  },
  transition: (_: unknown, patch: Partial<import("../takeoff/graph").TakeoffGraphPage>) => ({
    patch: { ...patch, stage: "sync" as const },
  }),
  verbs: Object.fromEntries(
    Object.entries(takeoffBase.verbs).filter(([id]) =>
      ["refresh", "sync", "retry-r10", "launch", "edit"].includes(id),
    ),
  ),
  panes: { ...takeoffBase.panes, navigation: { ...takeoffBase.panes.navigation!, verbs: [] } },
  layout: atlasLayout,
  stages: { sync: takeoffBase.stages.sync! },
};
