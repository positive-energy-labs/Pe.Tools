import { z } from "zod";
import { ductsRouteState, ductsSheetEditsSchema, fansDocumentSchema, fansReadArgs, fansReadResponse, fansSheetData, fansRouteState, listSearchSchema, type Immutable, type FansRouteDocument } from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { field, route, type DrawContext } from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { entries as ductEntries, localId, namesOf, schemas as shared } from "../ducts/neutral.ts";
import { fanLabel } from "../ducts/sheet/model.ts";
import { describeInputHistory, editMetaSchema } from "../ducts/sheet/input-history.neutral.ts";
import { sheetValueFixtures } from "../ducts/sheet/value-fixtures.ts";
import { presentLosses } from "../ducts/reviews.ts";

const fields = {
  fan: field(shared.fan, { kind: "ids", ids: [] }, "subject", "push"),
  stage: field(shared.sheetStage, "sheet", "stage", "push"),
  inputSort: field(shared.inputSort, "", "query"),
  inputSearch: field(shared.inputSearch, { keywords: "", pills: [], v: 1 }, "query"),
  contextRadiusFt: field(shared.contextRadiusFt, 10, "pose"),
  contextStyle: field(shared.contextStyle, "glass", "pose"),
  encoding: field(shared.encoding, "health", "pose", "push"),
  layers: field(shared.layers, ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"], "pose", "push"),
  picture: field(shared.picture, "model", "pose", "push"),
  rosterSearch: field(listSearchSchema, { keywords: "", pills: [], v: 1 }, "query"),
  rosterSort: field(z.enum(["", "name"]), "", "query"),
  sceneView: field(shared.sceneView, { preset: "all", section: null }, "pose"),
  sheetPath: field(shared.sheetPath, "", "query"),
  viewport: field(shared.viewport, null, "pose"),
};
const sheet = {
  ...hostRead("fans.sheet", { ...ductEntries["ducts.sheet"], input: fansReadArgs.omit({ target: true }), output: fansReadResponse }, sheetValueFixtures),
  args: (page: { fan: Immutable<z.output<typeof shared.fan>>; sheetPath: string }) => ({ fan: namesOf(page.fan), sheetPath: page.sheetPath }),
};
export type FansDrawContext = DrawContext<z.output<typeof fansSheetData>, typeof fields, FansRouteDocument, z.output<typeof ductsSheetEditsSchema>>;
export const module = route<z.output<typeof fansSheetData>, typeof fields, typeof fansDocumentSchema, typeof ductsSheetEditsSchema>({
  key: "fans", name: "Fans",
  directory: { aliases: ["fan", "ESP", "pressure"], exposure: "Main", group: "Calculate loads & airflow", icon: "Wind", label: "Fan ESP", listed: true, resume: "document", runtimeNeed: "Revit for model reads and writes", satellites: [], summary: "Inspect fan paths, inputs and pressure requirements", surfaces: { pwa: "full", tray: false, web: "full" } },
  subject: { field: "fan", noun: "fan", schema: shared.fan, namespace: "ducts-fan", pane: "sheet-roster",
    options: (data: FansDrawContext["value"]["value"]) => (data?.rows ?? []).map((row) => ({ id: localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`), label: fanLabel(row, data?.rows ?? []) })) },
  core: sheet, fields,
  panes: {
    "sheet-roster": { title: "Fans", purpose: "Open fan ports", read: sheet, draw: draw<FansDrawContext>(() => import("../ducts/sheet/mount.tsx").then((m) => ({ default: m.RosterBody }))) },
    "sheet-inputs": { title: "Inputs", purpose: "Edit fan inputs", read: sheet, draw: draw<FansDrawContext>(() => import("../ducts/sheet/mount.tsx").then((m) => ({ default: m.InputsBody }))) },
    "sheet-picture": { title: "Picture", purpose: "Inspect fan paths", read: sheet, draw: draw<FansDrawContext>(() => import("../ducts/sheet/mount.tsx").then((m) => ({ default: m.PictureBody }))) },
    "sheet-ledger": { title: "Ledger", purpose: "Inspect ESP and provenance", read: sheet, draw: draw<FansDrawContext>(() => import("../ducts/sheet/mount.tsx").then((m) => ({ default: m.LedgerBody }))) },
  },
  edits: { work: fansRouteState, owners: { fans: { state: fansRouteState, value: "fansWork" }, ducts: { state: ductsRouteState, value: "ductsWork" } }, input: ductsSheetEditsSchema,
    patches: (input, data) => editPatches(input, data.design), history: editMetaSchema, describe: describeInputHistory },
  commands: { losses: { entry: "ducts.apply-losses", plan: "ducts.plan-losses", contract: ductEntries["ducts.apply-losses"], planContract: ductEntries["ducts.plan-losses"], label: "Write to Revit", requires: ["writeIntent.edit.value.walk"],
    present: (result, data, work) => presentLosses(result, { page: { stage: "sheet" }, readings: { sheetSnapshot: { value: data.sheetSnapshot }, fansWork: { value: work } } }) } },
  layout: { kind: "split", id: "sheet-layout", axis: "h", size: 420, sized: "start", minOtherSize: 360, minSize: 280, rails: { start: { title: "Fans" } }, children: [
    { kind: "split", id: "sheet-side", axis: "v", size: 360, sized: "end", children: [{ kind: "pane", id: "sheet-roster" }, { kind: "pane", id: "sheet-inputs" }] },
    { kind: "split", id: "sheet-main", axis: "v", size: 360, sized: "start", children: [{ kind: "pane", id: "sheet-picture" }, { kind: "pane", id: "sheet-ledger" }] },
  ] },
});
export const fansData = module.data;
export const fansHostModule = module.host;
export function fansLink(ids: readonly string[], search: Readonly<Record<string, unknown>>) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"]) if (typeof search[key] === "string") params.set(key, search[key]);
  params.set("fan", JSON.stringify({ kind: "ids", ids: ids.map((id) => localId("ducts-fan", id)) }));
  return `/fans?${params}`;
}
