import { manyField } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";
import { takeoffBase, atlasLayout } from "../takeoff/graph";
export const zoneAuditGraph = {
  ...takeoffBase,
  key: "zone-audit",
  address: "zone-audit",
  name: "Zone audit",
  directory: {
    ...takeoffBase.directory!,
    path: "/zone-audit",
    title: "Zone audit",
    blurb: "Audit rooms in selected zones.",
  },
  seeds: Object.fromEntries(
    Object.entries(takeoffBase.seeds!).map(([id, seed]) => [
      id,
      {
        ...seed,
        load: async () => {
          const data = await seed.load();
          return { ...data, page: { ...data.page, stage: "audit" as const } };
        },
      },
    ]),
  ),
  subjectField: {
    field: "zones" as const,
    noun: "zone",
    keyKind: "UniqueId" as const,
    cardinality: "many" as const,
    roster: "roster",
    detail: "snapshot",
    pane: "scope",
    show: (id: string) => id,
  },
  subject: (p: import("../takeoff/graph").TakeoffGraphPage) =>
    (p.zones === "all" ? "All zones" : p.zones.join(", ")) || "Choose zones",
  fields: {
    ...takeoffBase.fields,
    views: { ...takeoffBase.fields.views, role: "query" as const },
    zones: {
      ...manyField("UniqueId", {}),
      role: "subject" as const,
      picker: {
        reading: "roster",
        placeholder: "Choose zones",
        options: (value: unknown) =>
          (value as { zones?: { id: string; label: string }[] })?.zones ?? [],
      },
      cardinality: "many" as const,
    },
    stage: { ...takeoffBase.fields.stage, schema: z.literal("audit").default("audit") },
  },
  transition: (_: unknown, patch: Partial<import("../takeoff/graph").TakeoffGraphPage>) => ({
    patch: { ...patch, stage: "audit" as const },
  }),
  verbs: Object.fromEntries(
    Object.entries(takeoffBase.verbs).filter(([id]) =>
      ["refresh", "partition", "room", "decide", "flag", "edit"].includes(id),
    ),
  ),
  panes: { ...takeoffBase.panes, adoption: { ...takeoffBase.panes.adoption!, verbs: [] } },
  layout: atlasLayout,
  stages: { audit: takeoffBase.stages.audit! },
};
