import { systemCode } from "./identity";
import { command } from "../route/typed-actions.ts";
import { poseFields } from "../route/defaults";
import { bindings } from "./bindings";
import { read } from "../route/defaults";
import { stageField } from "../route/defaults";
import { ductsRouteState } from "../../../../packages/agent-contracts/src/ducts.ts";
import { z } from "zod";
import {
  ductsPictureFields,
  listSearchSchema,
  fansRouteState,
  ductsSheetEditsSchema,
  ductsNetworkCapability,
  DUCTS_SYSTEM_MAX,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import {
  route,
  field,
  subjectSchema,
  namesOf,
  split,
  whenSubject,
} from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { describeInputHistory, editMetaSchema } from "./sheet/input-history.neutral.ts";
import { ductsPricingCapability, ductsRosterCapability } from "@pe/agent-contracts";
import { presentLosses, presentHeal, presentFan } from "./reviews.ts";
import { designSheet } from "./design-sheet.ts";

const shared = ductsPictureFields;
const system = subjectSchema(DUCTS_SYSTEM_MAX);
export const fields = {
  ...poseFields(shared, [
    "contextRadiusFt",
    "contextStyle",
    "encoding",
    "layers",
    "picture",
    "sceneView",
    "viewport",
  ]),
  system: field(system, { kind: "ids", ids: [] }, "subject", "push"),
  stage: stageField(["network"]),
  systemSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  systemSort: field(z.enum(["", "name", "loss"]), "", "query"),
  treeSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  treeSort: field(z.enum(["", "name"]), "", "query"),
  rulingSearch: field(listSearchSchema, { v: 1, keywords: "", pills: [] }, "query"),
  rulingSort: field(z.enum(["", "name", "status"]), "", "query"),
};
const args = (page: {
  system:
    | z.output<typeof system>
    | import("@pe/agent-contracts").Immutable<z.output<typeof system>>;
}) => ({ system: namesOf(page.system) });
export const roster = read(hostRead(ductsRosterCapability));
export const network = read(hostRead(ductsNetworkCapability), args);
export const pricing = read(hostRead(ductsPricingCapability), args);
export type { Context as DuctsDrawContext } from "./context.generated";
import type { Context as DuctsDrawContext } from "./context.generated";
const evidence = (
  data: DuctsDrawContext["value"]["value"],
  work: DuctsDrawContext["cells"]["doc"],
) => ({
  page: { stage: "network" as const },
  work,
  heal: data ? data.analysis.heal : null,
  readings: { ducts: { value: data?.network }, fansWork: { value: data?.fansWork } },
});
export const module = route({
  key: "ducts",
  host: "../../../host/src/reads/ducts.ts",
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
        id: systemCode(system.name),
        label: system.name,
      })),
  },
  core: pricing,
  fields,
  reads: { roster, network },
  sheet: designSheet,
  panes: {
    "e-systems": {
      subjectList: true,
      title: "Systems",
      purpose: "Choose a system to inspect",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "SystemsPane"),
    },
    "e-sidebar": {
      title: "System tree",
      purpose: "Inspect the opened systems and their runs",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "TreePane"),
    },
    "e-rules-all": {
      title: "All-systems rules",
      purpose: "Price every read fitting type",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "AllRulesBody"),
    },
    "e-rules": {
      title: "This system’s rules",
      purpose: "Review fitting rules for the opened systems",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "RulesBody"),
    },
    "e-picture": {
      title: "Picture",
      purpose: "Inspect the model or schematic",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "PictureBody"),
    },
    design: {
      title: "Design",
      purpose: "Stage the design criteria and friction rate over the firm file",
      kernel: "sheet",
      draw: () => null,
    },
    "e-inbox": {
      title: "Rulings",
      purpose: "Review assumptions and planned writes",
      bindings,
      draw: draw(() => import("./proto/e/screen.tsx"), "InboxBody"),
    },
  },
  edits: {
    seed: () => ductsRouteState.schema.parse({}),
    work: ductsRouteState,
    value: "ductsWork",
    owners: {
      fans: { state: fansRouteState, value: "fansWork" },
    },
    input: ductsSheetEditsSchema,
    patches: (input) => editPatches(input),
    history: editMetaSchema,
    describe: describeInputHistory,
  },
  commands: {
    losses: {
      ...command("sheet.apply"),
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
          split("v", [split("v", ["e-rules-all", whenSubject("e-rules")], {
            id: "scope-lower",
            size: 176,
            sized: "start",
          }), "design"], { id: "design-lower", size: 220, sized: "end" }),
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
