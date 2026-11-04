import {
  defineRouteGraph,
  ductsDocumentSchema,
  field,
  pane,
  type DuctsRouteDocument,
  type RouteGraph,
} from "@pe/agent-contracts";
import { z } from "zod";
import { ductsAddress } from "../../../../packages/agent-contracts/src/routes/ducts";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
type LegacyDuctFields = typeof threadListFields & typeof ductsAddress.fields;
type DuctsPage = { [K in keyof LegacyDuctFields]: z.output<LegacyDuctFields[K]["schema"]> } & {
  sheetPath: string;
};

// Generic legacy-owner tests need their old Page shape. This fixture has no domain
// sources, commands, cells or registration; production Ducts/Fans use admitted modules.
export const ductsPageGraph: RouteGraph<DuctsPage, DuctsRouteDocument> = defineRouteGraph({
  key: "ducts",
  address: "ducts",
  name: "Ducts",
  work: ductsDocumentSchema,
  fields: {
    ...threadListFields,
    ...ductsAddress.fields,
    system: {
      ...ductsAddress.fields.system,
      role: "subject",
      picker: {
        reading: "rows",
        placeholder: "Choose a subject",
        options: (value: unknown) =>
          (value as { rows: { id: string; label: string }[] } | null)?.rows ?? [],
      },
    },
    fan: { ...ductsAddress.fields.fan, role: "query" },
    selected: { ...ductsAddress.fields.selected, role: "selection" },
    sheetPath: { ...field(z.string().default(""), {}), role: "transient", url: false },
  },
  subjectField: {
    field: "system",
    noun: "system",
    keyKind: "system-name",
    cardinality: "many",
    roster: "rows",
    detail: "rows",
    pane: "roster",
  },
  readings: { rows: {} },
  verbs: {},
  panes: { roster: { label: "Subjects", purpose: "Pick a subject", draws: ["rows"], verbs: [] } },
  stages: { network: { word: "Subjects", panes: ["roster"], verbs: [] } },
  layout: pane("roster"),
});
export const systemSubjectGraph = ductsPageGraph;
export const fanSubjectGraph: typeof ductsPageGraph = {
  ...ductsPageGraph,
  key: "fans",
  address: "fans",
  name: "Fans",
  fields: {
    ...ductsPageGraph.fields,
    stage: {
      ...ductsPageGraph.fields.stage,
      schema: z.enum(["network", "sheet"]).default("sheet"),
    },
    system: { ...ductsPageGraph.fields.system, role: "query", picker: undefined },
    fan: {
      ...ductsPageGraph.fields.fan,
      role: "subject",
      picker: {
        reading: "rows",
        placeholder: "Choose a subject",
        options: (value: unknown) =>
          (
            value as {
              rows: { unitId: number; uniqueId: string; portIndex: number; mark: string }[];
            } | null
          )?.rows.map((row) => ({ id: `${row.uniqueId}@${row.portIndex}`, label: row.mark })) ?? [],
      },
    },
  },
  subjectField: {
    field: "fan",
    noun: "fan",
    keyKind: "UniqueId",
    cardinality: "many",
    roster: "rows",
    detail: "rows",
    pane: "roster",
    show: (id: string) => id,
  },
  stages: { sheet: { word: "Fans", panes: ["roster"], verbs: [] } },
};
