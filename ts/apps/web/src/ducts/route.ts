import { ductsRouteState } from "../../../../packages/agent-contracts/src/ducts.ts";
import { z } from "zod";
import {
  ductsPictureFields,
  listSearchSchema,
  fansRouteState,
  ductsSheetEditsSchema,
  ductsNetworkCapability,
  DUCTS_SYSTEM_MAX,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import {
  route,
  field,
  subjectSchema,
  namesOf,
  localId,
  command,
  split,
  whenSubject,
  type DrawContext,
} from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { describeInputHistory, editMetaSchema } from "./sheet/input-history.neutral.ts";
import { ductsPricingCapability, ductsRosterCapability, ductsPricingData } from "@pe/agent-contracts";
import { presentLosses, presentHeal, presentFan } from "./reviews.ts";

const shared = ductsPictureFields;
const system = subjectSchema(DUCTS_SYSTEM_MAX);
const fields = {
  system: field(system, { kind: "ids", ids: [] }, "subject", "push"),
  stage: field(z.enum(["network"]), "network", "stage", "push"),
  systemSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  systemSort: field(z.enum(["", "name", "loss"]), "", "query"),
  treeSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  treeSort: field(z.enum(["", "name"]), "", "query"),
  rulingSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  rulingSort: field(z.enum(["", "name", "status"]), "", "query"),
  contextRadiusFt: field(shared.contextRadiusFt.schema, 10, "pose"),
  contextStyle: field(shared.contextStyle.schema, "glass", "pose"),
  encoding: field(shared.encoding.schema, "health", "pose", "push"),
  layers: field(
    shared.layers.schema,
    ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"],
    "pose",
    "push",
  ),
  picture: field(shared.picture.schema, "model", "pose", "push"),
  sceneView: field(shared.sceneView.schema, { preset: "all", section: null }, "pose"),
  viewport: field(shared.viewport.schema, null, "pose"),
};
const args = (page: {
  system:
    | z.output<typeof system>
    | import("@pe/agent-contracts").Immutable<z.output<typeof system>>;
}) => ({ system: namesOf(page.system) });
export const roster = { ...hostRead(ductsRosterCapability), args: () => ({}) };
export const network = { ...hostRead(ductsNetworkCapability), args };
const pricing = { ...hostRead(ductsPricingCapability), args };
export type DuctsDrawContext = DrawContext<
  z.output<typeof ductsPricingData>,
  typeof fields,
  DuctsRouteDocument,
  z.output<typeof ductsSheetEditsSchema>
>;
const evidence = (
  data: DuctsDrawContext["value"]["value"],
  work: DuctsDrawContext["cells"]["doc"],
) => ({
  page: { stage: "network" as const },
  work,
  heal: data ? data.analysis.heal as import("@pe/ducts-domain/heal").HealPlan : null,
  readings: { ducts: { value: data?.network }, fansWork: { value: data?.fansWork } },
});
export const module = route({
  key: "ducts",
  name: "Ducts",
  directory: {
    group: "Calculate loads & airflow",
    summary: "Review duct systems, stage inputs and rulings, and plan writes to Revit",
    label: "Pressure drop",
    icon: "Wind",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["duct", "pressure", "airflow", "systems"],
    runtimeNeed: "Revit for model reads and writes",
    listed: true,
    satellites: [],
    resume: "document",
  },
  subject: {
    field: "system",
    noun: "system",
    pane: "e-systems",
    read: roster,
    options: (data) =>
      (data?.systems ?? []).map((system) => ({
        id: localId("ducts-system", system.name),
        label: system.name,
      })),
  },
  core: pricing,
  fields,
  reads: { roster, network },
  panes: {
    "e-systems": {
      title: "Systems",
      purpose: "Choose a system to inspect",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "SystemsPane"),
    },
    "e-sidebar": {
      title: "System tree",
      purpose: "Inspect the opened systems and their runs",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "TreePane"),
    },
    "e-rules-all": {
      title: "All-systems rules",
      purpose: "Price every read fitting type",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "AllRulesBody"),
    },
    "e-rules": {
      title: "This system’s rules",
      purpose: "Review fitting rules for the opened systems",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "RulesBody"),
    },
    "e-picture": {
      title: "Picture",
      purpose: "Inspect the model or schematic",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "PictureBody"),
    },
    "e-inbox": {
      title: "Rulings",
      purpose: "Review assumptions and planned writes",
      read: pricing,
      draw: draw(() => import("./proto/e/screen.tsx"), "InboxBody"),
    },
  },
  edits: {
    work: ductsRouteState,
    value: "ductsWork",
    owners: {
      fans: { state: fansRouteState, value: "fansWork" },
    },
    input: ductsSheetEditsSchema,
    patches: (input, data) => editPatches(input, data.design),
    history: editMetaSchema,
    describe: describeInputHistory,
  },
  commands: {
    losses: {
      ...command("ducts.apply-losses"),
      label: "Write to Revit",
      present: (result, data, work) => presentLosses(result, evidence(data, work)),
    },
    heal: {
      ...command("ducts.apply-heal"),
      label: "Heal",
      present: (result, data, work) => presentHeal(result, evidence(data, work)),
    },
    assign: {
      ...command("ducts.apply-assign-fan"),
      label: "Make the fan",
      present: (result, data, work) => presentFan(result, evidence(data, work)),
    },
  },
  layout: split(
    "h",
    [
      split(
        "v",
        [
          split("v", ["e-systems", whenSubject("e-sidebar")], {
            id: "scope-upper",
            size: 240,
            sized: "start",
          }),
          split("v", ["e-rules-all", whenSubject("e-rules")], {
            id: "scope-lower",
            size: 176,
            sized: "start",
          }),
        ],
        { id: "stack", size: 300, sized: "end" },
      ),
      split("h", ["e-picture", "e-inbox"], {
        id: "drawing",
        size: 340,
        sized: "end",
        minSize: 260,
        maxSize: 520,
        minOtherSize: 360,
        rails: { end: { title: "Rulings" } },
      }),
    ],
    {
      id: "sidebar",
      size: 420,
      sized: "start",
      minSize: 280,
      maxSize: 760,
      minOtherSize: 360,
      rails: { start: { title: "Systems" } },
    },
  ),
});
export const ductsData = module.data;
export const ductsHostModule = module.host;
