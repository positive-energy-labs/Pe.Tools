import { z } from "zod";
import {
  ductsRouteState,
  ductsSheetEditsSchema,
  fansSheetCapability,
  ductsAddress,
  fansSheetData,
  fansRouteState,
  listSearchSchema,
  type Immutable,
  type FansRouteDocument,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import {
  field,
  route,
  subjectSchema,
  localId,
  namesOf,
  command,
  split,
  type DrawContext,
} from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { fanLabel } from "../ducts/sheet/model.ts";
import { describeInputHistory, editMetaSchema } from "../ducts/sheet/input-history.neutral.ts";
import { sheetValueFixtures } from "../ducts/sheet/value-fixtures.ts";
import { presentLosses } from "../ducts/reviews.ts";

const shared = ductsAddress.fields;
const fan = subjectSchema(32);

const fields = {
  fan: field(fan, { kind: "ids", ids: [] }, "subject", "push"),
  stage: field(z.enum(["sheet"]), "sheet", "stage", "push"),
  inputSort: field(shared.inputSort.schema, "", "query"),
  inputSearch: field(shared.inputSearch.schema, { keywords: "", pills: [], v: 1 }, "query"),
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
  rosterSearch: field(listSearchSchema, { keywords: "", pills: [], v: 1 }, "query"),
  rosterSort: field(z.enum(["", "name"]), "", "query"),
  sceneView: field(shared.sceneView.schema, { preset: "all", section: null }, "pose"),
  sheetPath: field(z.string(), "", "query"),
  viewport: field(shared.viewport.schema, null, "pose"),
};
const sheet = {
  ...hostRead(fansSheetCapability, sheetValueFixtures),
  args: (page: { fan: Immutable<z.output<typeof fan>>; sheetPath: string }) => ({
    fan: namesOf(page.fan),
    sheetPath: page.sheetPath,
  }),
};
const roster = {
  ...hostRead(fansSheetCapability, sheetValueFixtures),
  args: () => ({ fan: [], sheetPath: "" }),
};
export type FansDrawContext = DrawContext<
  z.output<typeof fansSheetData>,
  typeof fields,
  FansRouteDocument,
  z.output<typeof ductsSheetEditsSchema>
>;
export const module = route({
  key: "fans",
  name: "Fans",
  directory: {
    aliases: ["fan", "ESP", "pressure"],
    exposure: "Main",
    group: "Calculate loads & airflow",
    icon: "Wind",
    label: "Fan ESP",
    listed: true,
    resume: "document",
    runtimeNeed: "Revit for model reads and writes",
    satellites: [],
    summary: "Inspect fan paths, inputs and pressure requirements",
    surfaces: { pwa: "full", tray: false, web: "full" },
  },
  subject: {
    field: "fan",
    read: roster,
    noun: "fan",
    pane: "sheet-roster",
    options: (data: FansDrawContext["value"]["value"]) =>
      (data?.rows ?? []).map((row) => ({
        id: localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`),
        label: fanLabel(row, data?.rows ?? []),
      })),
  },
  core: sheet,
  reads: { roster },
  fields,
  panes: {
    "sheet-roster": {
      title: "Fans",
      purpose: "Open fan ports",
      read: sheet,
      draw: draw(() => import("../ducts/sheet/mount.tsx"), "RosterBody"),
    },
    "sheet-inputs": {
      title: "Inputs",
      purpose: "Edit fan inputs",
      read: sheet,
      draw: draw(() => import("../ducts/sheet/mount.tsx"), "InputsBody"),
    },
    "sheet-picture": {
      title: "Picture",
      purpose: "Inspect fan paths",
      read: sheet,
      draw: draw(() => import("../ducts/sheet/mount.tsx"), "PictureBody"),
    },
    "sheet-ledger": {
      title: "Ledger",
      purpose: "Inspect ESP and provenance",
      read: sheet,
      draw: draw(() => import("../ducts/sheet/mount.tsx"), "LedgerBody"),
    },
  },
  edits: {
    work: fansRouteState,
    owners: {
      fans: { state: fansRouteState, value: "fansWork" },
      ducts: { state: ductsRouteState, value: "ductsWork" },
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
      present: (result, data, work) =>
        presentLosses(result, {
          page: { stage: "sheet" },
          readings: { sheetSnapshot: { value: data.sheetSnapshot }, fansWork: { value: work } },
        }),
    },
  },
  layout: split(
    "h",
    [
      split("v", ["sheet-roster", "sheet-inputs"], { id: "sheet-side", size: 360, sized: "end" }),
      split("v", ["sheet-picture", "sheet-ledger"], {
        id: "sheet-main",
        size: 360,
        sized: "start",
      }),
    ],
    {
      id: "sheet-layout",
      size: 420,
      sized: "start",
      minOtherSize: 360,
      minSize: 280,
      rails: { start: { title: "Fans" } },
    },
  ),
});
export const fansData = module.data;
export const fansHostModule = module.host;
export function fansLink(ids: readonly string[], search: Readonly<Record<string, unknown>>) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  params.set(
    "fan",
    JSON.stringify({ kind: "ids", ids: ids.map((id) => localId("ducts-fan", id)) }),
  );
  return `/fans?${params}`;
}
