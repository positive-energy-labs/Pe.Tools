import { z } from "zod";
import { pane } from "@pe/agent-contracts";
import { schedulesBase, type SchedulesPage } from "../schedules/graph";
export const scheduleSpecsGraph = {
  ...schedulesBase,
  key: "schedule-specs", address: "schedule-specs", name: "Schedule definitions",
  directory: { ...schedulesBase.directory!, path: "/schedule-specs", title: "Schedule definitions", blurb: "Author a saved schedule definition and apply it as a new schedule." },
  seeds: { apply: { title: "Saved schedule definition", load: async () => { const { schedulesSeeds } = await import("../schedules/graph-seeds"); return { ...schedulesSeeds.apply, page: { ...schedulesSeeds.apply.page, stage: "apply" as const, pod: "demo", path: "schedules/mechanical.json" } }; } } },
  subjectField: { field: "path" as const, noun: "schedule definition", keyKind: "name" as const, cardinality: "one" as const, roster: "pods", detail: "pods", pane: "spec", show: (id: string) => id },
  subject: (p: SchedulesPage) => p.path ? `${p.pod}/${p.path}` : "Choose a definition",
  fields: { ...schedulesBase.fields, workspaceId: { ...schedulesBase.fields.workspaceId, role: "selection" as const }, pod: { ...schedulesBase.fields.pod, role: "selection" as const }, stage: { ...schedulesBase.fields.stage, schema: z.literal("apply").default("apply") } },
  transition: (_: unknown, patch: Partial<SchedulesPage>) => ({ patch: { ...patch, stage: "apply" as const } }),
  verbs: { apply: schedulesBase.verbs.apply! },
  panes: { spec: { ...schedulesBase.panes.spec!, verbs: ["apply"] } },
  layout: pane("spec"),
  stageOrder: ["apply"],
  stages: { apply: { word: "Authoring definitions", panes: ["spec"], verbs: ["apply"] } },
};
