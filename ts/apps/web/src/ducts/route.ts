import type { ContextOf } from "../route/defaults";
import { systemCode, fanScopeSchema, type FanScope } from "./identity";
import { handle } from "@pe/agent-contracts/handle";
import { bindings } from "./bindings";
import { read } from "../route/defaults";
import { stageField } from "../route/defaults";
import { ductsRouteState } from "../../../../packages/agent-contracts/src/ducts.ts";
import { z } from "zod";
import {
  listSearchSchema,
  ductsSheetEditsSchema,
  DUCTS_SYSTEM_MAX,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import {
  route,
  field,
  picturePose,
  subjectSchema,
  namesOf,
  split,
  whenSubject,
} from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { fillBody, scrollBody } from "../route/body.ts";
import { overlay } from "../route/slots/picture/overlay.tsx";
import { describeInputHistory, editMetaSchema } from "./sheet/input-history.neutral.ts";
import * as reads from "./contract.ts";
import { presentLosses, presentHeal, presentFan } from "./reviews.ts";
import { designSheet } from "./design-sheet.ts";

const system = subjectSchema(DUCTS_SYSTEM_MAX);
export const fields = {
  ...picturePose,
  fan: field(fanScopeSchema.nullable(), null, "query"),
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
  fan?: FanScope | null;
  system:
    | z.output<typeof system>
    | import("@pe/agent-contracts").Immutable<z.output<typeof system>>;
}) => ({ system: namesOf(page.system), fan: page.fan });
export const roster = read(hostRead(reads.roster));
export const network = read(hostRead(reads.network), args);
export const pricing = read(hostRead(reads.pricing), args);
export type DuctsDrawContext = ContextOf<typeof fields, typeof pricing, typeof import("../../../../packages/agent-contracts/src/ducts.ts").ductsRouteState, typeof import("@pe/agent-contracts").ductsSheetEditsSchema>;
/** What every ducts pane shares, whichever read it names: the pane's own `value` is not part of it. */
export type DuctsReads = Omit<DuctsDrawContext, "value">;
/** The systems pane draws the roster, so it still lists systems while pricing is read or refused. */
export type DuctsSystemsContext = DuctsReads & Pick<ContextOf<typeof fields, typeof roster>, "value">;
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
  host: "./host.ts",
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
  // The picture is of the opened systems. A system is a name, not geometry: the overlay hands the kernel
  // its members to capture, with the stubs, labels, rulings and schematic the closed marks cannot express.
  picture: { scope: "subject", overlay: overlay(() => import("./proto/e/screen.tsx"), "NetworkPicture") },
  panes: {
    "e-systems": {
      subjectList: true,
      title: "Systems",
      purpose: "Choose a system to inspect",
      read: roster,
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./proto/e/screen.tsx"), "SystemsPane"),
    },
    "e-sidebar": {
      title: "System tree",
      purpose: "Inspect the opened systems and their runs",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./proto/e/screen.tsx"), "TreePane"),
    },
    "e-rules-all": {
      title: "All-systems rules",
      purpose: "Price every read fitting type",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./proto/e/screen.tsx"), "AllRulesBody"),
    },
    "e-rules": {
      title: "This system’s rules",
      purpose: "Review fitting rules for the opened systems",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./proto/e/screen.tsx"), "RulesBody"),
    },
    "e-picture": {
      title: "Picture",
      purpose: "Inspect the model or schematic",
      bindings,
      kernel: "picture",
      // The shell draws this pane from the picture slot; a picture fills its pane.
      body: "fill",
      draw: () => fillBody(null),
    },
    design: {
      title: "Design",
      purpose: "Stage the design criteria and friction rate over the firm file",
      kernel: "sheet",
      body: "scroll",
      draw: () => scrollBody(null),
    },
    "e-inbox": {
      title: "Rulings",
      purpose: "Review assumptions and planned writes",
      bindings,
      body: "scroll",
      draw: draw("scroll", () => import("./proto/e/screen.tsx"), "InboxBody"),
    },
  },
  edits: {
    seed: () => ductsRouteState.schema.parse({}),
    work: ductsRouteState,
    value: "ductsWork",
    // No cross-route write (ruling 2026-11-10): /ducts owns only its Work; the host reads Fans Work into its core read.
    owners: {},
    input: ductsSheetEditsSchema,
    patches: (input) => editPatches(input),
    history: editMetaSchema,
    describe: describeInputHistory,
  },
  verbs: {
    losses: {
      handle: handle("sheet.apply"),
      label: "Write to Revit",
      present: (result, { value: data, doc: work }) => presentLosses(result, evidence(data, work)),
    },
    heal: {
      handle: handle("ducts.apply-heal"),
      label: "Heal",
      present: (result, { value: data, doc: work }) => presentHeal(result, evidence(data, work)),
    },
    assign: {
      handle: handle("ducts.apply-assign-fan"),
      label: "Make the fan",
      present: (result, { value: data, doc: work }) => presentFan(result, evidence(data, work)),
    },
  },
  band: ["losses", "heal", "assign"],
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
