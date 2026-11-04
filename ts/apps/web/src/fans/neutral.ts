import { applyPatches, fansDocumentSchema, fansRouteState, listSearchSchema, type FansRouteDocument } from "@pe/agent-contracts";
import { z } from "zod";
import type { BodyBindings, WorkPatch } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { Immutable, RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { entries as ductEntries, localId, namesOf, openSheetSchema, schemas as sharedSchemas } from "../ducts/neutral.ts";
import { fanLabel, TIERS } from "../ducts/sheet/model.ts";
import { describeInputHistory, editLabel } from "../ducts/sheet/input-history.ts";
import { editPatches } from "@pe/ducts-domain/sheet/index";

export const fansData = {
  predicates: {},
  seeds: { sheet: { title: "Fan sheet", load: "seedSheet" } },
  "address": "/fans",
  "capabilities": ["work", "geometry"],
  "cells": {
    "calculation": { "groupOf": "groupcalculation", "segment": "calculation", "value": "calculationCell", "deps": { "page": [], "work": [], "readings": [] } },
    "terminalDrops": { "groupOf": "groupterminalDrops", "segment": "terminalDrops", "value": "terminalDropsCell", "deps": { "page": [], "work": [], "readings": [] } },
    "componentDrops": { "groupOf": "groupcomponentDrops", "segment": "componentDrops", "value": "componentDropsCell", "deps": { "page": [], "work": [], "readings": [] } },
    "esp": { "groupOf": "groupesp", "segment": "esp", "value": "espCell", "deps": { "page": [], "work": [], "readings": [] } },
    "equipmentFlows": { "groupOf": "groupequipmentFlows", "segment": "equipmentFlows", "value": "equipmentFlowsCell", "deps": { "page": [], "work": [], "readings": [] } },
    "roles": { "groupOf": "grouproles", "segment": "roles", "value": "rolesCell", "deps": { "page": [], "work": [], "readings": [] } },
    "flows": { "groupOf": "groupflows", "segment": "flows", "value": "flowsCell", "deps": { "page": [], "work": [], "readings": [] } },
    "parameters": { "groupOf": "groupparameters", "segment": "parameters", "value": "parametersCell", "deps": { "page": [], "work": [], "readings": [] } },
    "designFriction": { "groupOf": "groupdesignFriction", "segment": null, "value": "designFrictionCell", "deps": { "page": [], "work": [], "readings": [] } }
  },
  "directory": {
    "aliases": ["fan", "ESP", "pressure"],
    "exposure": "Main",
    "group": "Calculate loads & airflow",
    "icon": "Wind",
    "label": "Fan ESP",
    "listed": true,
    "resume": "document",
    "runtimeNeed": "Revit for model reads and writes",
    "satellites": [],
    "summary": "Inspect fan paths, inputs and pressure requirements",
    "surfaces": { "pwa": "full", "tray": false, "web": "full" }
  },
  "fields": {
    "inputSort": {"agent": "set", "codec": "inputSort", "initial": "", "role": "query", "schema": "inputSort", "share": true, "url": "replace"},
    "inputSearch": {"agent": "set", "codec": "inputSearch", "initial": {"keywords": "", "pills": [], "v": 1}, "role": "query", "schema": "inputSearch", "share": true, "url": "replace"},
    "contextRadiusFt": { "agent": "set", "codec": "contextRadiusFt", "initial": 10, "role": "pose", "schema": "contextRadiusFt", "share": true, "url": "replace" },
    "contextStyle": { "agent": "set", "codec": "contextStyle", "initial": "glass", "role": "pose", "schema": "contextStyle", "share": true, "url": "replace" },
    "encoding": { "agent": "set", "codec": "encoding", "initial": "health", "role": "pose", "schema": "encoding", "share": true, "url": "push" },
    "fan": { "agent": "set", "cardinality": "many", "codec": "fan", "identity": "fan", "initial": { "ids": [], "kind": "ids" }, "picker": { "options": "pickFans", "reading": "fans" }, "role": "subject", "schema": "fan", "share": true, "url": "push" },
    "layers": { "agent": "set", "codec": "layers", "initial": ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"], "role": "pose", "schema": "layers", "share": true, "url": "push" },
    "picture": { "agent": "set", "codec": "picture", "initial": "model", "role": "pose", "schema": "picture", "share": true, "url": "push" },
    "rosterSearch": { "agent": "set", "codec": "rosterSearch", "initial": { "keywords": "", "pills": [], "v": 1 }, "role": "query", "schema": "rosterSearch", "share": true, "url": "replace" },
    "rosterSort": { "agent": "set", "codec": "rosterSort", "initial": "", "role": "query", "schema": "rosterSort", "share": true, "url": "replace" },
    "sceneView": { "agent": "set", "codec": "sceneView", "initial": { "preset": "all", "section": null }, "role": "pose", "schema": "sceneView", "share": true, "url": "replace" },
    "selected": { "kinds": ["focus"], "role": "selection" },
    "sheetPath": { "agent": "set", "codec": "sheetPath", "initial": "", "role": "query", "schema": "sheetPath", "share": true, "url": "replace" },
    "stage": { "agent": "set", "codec": "stage", "initial": "sheet", "role": "stage", "schema": "sheetStage", "share": true, "url": "push" },
    "viewport": { "agent": "set", "codec": "viewport", "initial": null, "role": "pose", "schema": "viewport", "share": true, "url": "replace" }
  },
  "historyDetail": "historyDetail",
  "identities": { "fan": { "codec": "local", "kind": "local" }, "focus": { "codec": "local", "kind": "local" } },
  "key": "fans",
  "layout": {
    "axis": "h",
    "children": [{"axis": "v", "children": [{"id": "sheet-roster", "kind": "pane"}, {"id": "sheet-inputs", "kind": "pane"}], "id": "sheet-side", "kind": "split", "size": 360, "sized": "end"}, {"axis": "v", "children": [{"id": "sheet-picture", "kind": "pane"}, {"id": "sheet-ledger", "kind": "pane"}], "id": "sheet-main", "kind": "split", "size": 360, "sized": "start"}],
    "id": "sheet-layout",
    "kind": "split",
    "minOtherSize": 360,
    "minSize": 280,
    "rails": { "start": { "title": "Fans" } },
    "size": 420,
    "sized": "start"
  },
  "name": "Fans",
  "needs": "project",
  "observe": [],
  "panes": {
    "sheet-inputs": { "body": "sheet-inputs", "draws": ["fans", "sheet", "sheetSnapshot", "sheetView"], "label": "Inputs", "purpose": "Edit fan inputs", "verbs": ["browse", "edit", "scope", "sheetEdit"] },
    "sheet-ledger": { "body": "sheet-ledger", "draws": ["fans", "sheet", "sheetSnapshot", "sheetView"], "label": "Ledger", "purpose": "Inspect ESP and provenance", "verbs": ["browse", "edit", "scope", "sheetEdit"] },
    "sheet-picture": { "body": "sheet-picture", "draws": ["fans", "sheet", "sheetSnapshot", "sheetView"], "label": "Picture", "purpose": "Inspect fan paths", "verbs": ["browse", "edit", "scope", "sheetEdit"] },
    "sheet-roster": { "body": "sheet-roster", "draws": ["fans", "sheet", "sheetSnapshot"], "label": "Fans", "purpose": "Open fan ports", "verbs": ["browse", "edit", "scope", "sheetEdit"] }
  },
  "readings": {
    "fans": { "args": "fansArgs", "demand": "visible", "deps": { "page": [], "readings": [], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "entry": "ducts.fans", "kind": "use", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } },
    "meshes": { "demand": "visible", "deps": { "page": [], "readings": [], "work": [] }, "derive": "meshes", "kind": "derive", "output": "snapshot", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } },
    "pricing": { "demand": "visible", "deps": { "page": [], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"], "readings": ["sheet"] }, "derive": "price", "kind": "derive", "output": "pricing", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } },
    "sheet": { "args": "sheetArgs", "demand": "visible", "deps": { "page": ["fan", "sheetPath"], "readings": ["fans"], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "entry": "ducts.sheet", "kind": "use", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } },
    "sheetSnapshot": { "args": "sheetSnapshotArgs", "demand": "visible", "deps": { "page": [], "readings": ["sheet"], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "entry": "ducts.sheet-snapshot", "kind": "use", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } },
    "sheetView": { "demand": "visible", "deps": { "page": [], "readings": ["sheet"], "work": [] }, "derive": "sheetView", "kind": "derive", "output": "sheetView", "refresh": "dependencies", "retain": { "evidence": "scope", "resource": "scope" } }
  },
  "resetOnTarget": [],
  "stageOrder": ["sheet"],
  "stages": {
    "sheet": { "panes": ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"], "verbs": [], "word": "Pricing fans" }
  },
  "subject": { "detail": "sheet", "field": "fan", "noun": "fan", "pane": "sheet-roster", "roster": "fans" },
  "verbs": {
    "browse": { "captures": [], "deps": { "page": [], "readings": [], "work": [] }, "fields": ["sheetPath", "rosterSearch", "rosterSort", "inputSearch", "inputSort"], "input": "browse", "kind": "page", "label": "Browse", "patch": "browse", "review": "none" },
    "edit": { "captures": [], "deps": { "page": [], "readings": [], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "describe": "describeEdit", "input": "edit", "kind": "work", "label": "Edit", "patches": "edit", "review": "none" },
    "scope": { "captures": [], "deps": { "page": [], "readings": [], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "describe": "describeScope", "input": "scope", "kind": "work", "label": "Choose write scope", "patches": "scope", "review": "none" },
    "sheetEdit": { "captures": [], "deps": { "page": [], "readings": ["sheet"], "work": ["writeIntent", "calculation", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "flows", "parameters", "designFriction"] }, "describe": "describeSheet", "input": "sheetEdit", "kind": "work", "label": "Edit sheet inputs", "patches": "sheetEdit", "ready": "sheetReady", "review": "none" }
  },
  "version": 1,
  "work": { "schema": "work", "route": "fans", "version": 1, "migrations": {  } },
  "workFields": { "writeIntent": { "label": "write scope", "internal": true } }
} as const satisfies RouteGraphJson;
const rosterSort = z.enum(["", "name"]);
export const schemas = {
  ...sharedSchemas,
  work: fansDocumentSchema,
  scope: fansDocumentSchema.shape.writeIntent.unwrap().shape.edit.unwrap().unwrap().shape.value,
  browse: z.strictObject({ inputSearch: sharedSchemas.inputSearch.optional(), inputSort: sharedSchemas.inputSort.optional(), sheetPath: z.string().optional(), rosterSearch: listSearchSchema.optional(), rosterSort: rosterSort.optional() }),
  rosterSearch: listSearchSchema,
  rosterSort,
  sheetView: z.object({
    blockers: openSheetSchema.shape.inputs.unwrap().shape.blockers,
    tiers: z.record(z.enum(TIERS), z.number().int().nonnegative()),
    taken: z.array(z.string()),
    inputs: openSheetSchema.shape.inputs.unwrap().shape.inputs.nullable(),
    firm: openSheetSchema.shape.inputs.unwrap().shape.firm.nullable(),
  }),
  calculationCell: fansDocumentSchema.shape.calculation.unwrap().valueType,
  terminalDropsCell: fansDocumentSchema.shape.terminalDrops.unwrap().valueType,
  componentDropsCell: fansDocumentSchema.shape.componentDrops.unwrap().valueType,
  espCell: fansDocumentSchema.shape.esp.unwrap().valueType,
  equipmentFlowsCell: fansDocumentSchema.shape.equipmentFlows.unwrap().valueType,
  rolesCell: fansDocumentSchema.shape.roles.unwrap().valueType,
  flowsCell: fansDocumentSchema.shape.flows.unwrap().valueType,
  parametersCell: fansDocumentSchema.shape.parameters.unwrap().valueType,
  designFrictionCell: fansDocumentSchema.shape.designFriction.unwrap(),
};
const workSchema: z.ZodType<Immutable<FansRouteDocument>> = fansDocumentSchema;
const fanReadingSchema: z.ZodType<Immutable<z.output<typeof ductEntries["ducts.fans"]["output"]>>> = ductEntries["ducts.fans"].output;
const sheetReadingSchema: z.ZodType<Immutable<z.output<typeof sharedSchemas.sheet>>> = sharedSchemas.sheet;
export const entries = {
  "ducts.fans": { ...ductEntries["ducts.fans"], input: z.object({ work: workSchema.nullable() }) },
  "ducts.sheet": { ...ductEntries["ducts.sheet"], input: ductEntries["ducts.sheet"].input.extend({ work: workSchema.nullable(), fans: fanReadingSchema }) },
  "ducts.sheet-snapshot": { ...ductEntries["ducts.sheet-snapshot"], input: ductEntries["ducts.sheet-snapshot"].input.extend({ work: workSchema.nullable(), sheet: sheetReadingSchema }) },
};
const source = { module: "fans/neutral.ts", export: "fansNeutralBodies" };
function patches(work: import("../../../../packages/agent-contracts/src/route-kernel-data.ts").Immutable<FansRouteDocument>, input: readonly import("@pe/agent-contracts").RouteStatePatch[]): readonly WorkPatch<typeof fansDocumentSchema>[] {
  const next = applyPatches(fansRouteState, { version: 1, revision: 0, doc: work }, "human", input, 0, false, true);
  if (!next.ok) throw Error(next.error);
  const doc = next.envelope.doc;
  const roots: readonly WorkPatch<typeof fansDocumentSchema>[] = [
    { path: ["writeIntent"], value: doc.writeIntent },
    { path: ["calculation"], value: doc.calculation },
    { path: ["terminalDrops"], value: doc.terminalDrops },
    { path: ["componentDrops"], value: doc.componentDrops },
    { path: ["esp"], value: doc.esp },
    { path: ["equipmentFlows"], value: doc.equipmentFlows },
    { path: ["roles"], value: doc.roles },
    { path: ["flows"], value: doc.flows },
    { path: ["parameters"], value: doc.parameters },
    { path: ["designFriction"], value: doc.designFriction },
  ];
  return roots.filter(root => input.some(patch => patch.path[0] === root.path[0]));
}
export const fansNeutralBodies = {
  groupdesignFriction: { slot: "cells.designFriction.groupOf", kind: "group", source, run: key => [key] },
  groupparameters: { slot: "cells.parameters.groupOf", kind: "group", source, run: key => [key] },
  groupflows: { slot: "cells.flows.groupOf", kind: "group", source, run: key => [key] },
  grouproles: { slot: "cells.roles.groupOf", kind: "group", source, run: key => [key] },
  groupequipmentFlows: { slot: "cells.equipmentFlows.groupOf", kind: "group", source, run: key => [key] },
  groupesp: { slot: "cells.esp.groupOf", kind: "group", source, run: key => [key] },
  groupcomponentDrops: { slot: "cells.componentDrops.groupOf", kind: "group", source, run: key => [key] },
  groupterminalDrops: { slot: "cells.terminalDrops.groupOf", kind: "group", source, run: key => [key] },
  groupcalculation: { slot: "cells.calculation.groupOf", kind: "group", source, run: key => [key] },
  browse: { slot: "verbs.browse.patch", kind: "page", source, run: (_ctx, input) => input },
  edit: { slot: "verbs.edit.patches", kind: "work", source, run: (ctx, input) => patches(ctx.work, input.patches) },
  describeEdit: { slot: "verbs.edit.describe", kind: "describe", source, run: input => describeInputHistory(input.history ?? { label: "Edit" }) },
  sheetEdit: { slot: "verbs.sheetEdit.patches", kind: "work", source, run: (ctx, input) => patches(ctx.work, editPatches(input.edits, null)) },
  sheetReady: { slot: "verbs.sheetEdit.ready", kind: "ready", source, run: (ctx, input) => ctx.readings.sheet.current && input.basis === ctx.readings.sheet.value?.open?.overview.basis ? true : "Read the current sheet before editing its inputs" },
  describeSheet: { slot: "verbs.sheetEdit.describe", kind: "describe", source, run: input => describeInputHistory(input.history ?? { label: editLabel(input.edits, () => null) }) },
  scope: { slot: "verbs.scope.patches", kind: "work", source, run: (_, input) => [{ path: ["writeIntent"], value: { edit: { value: input } } }] },
  describeScope: { slot: "verbs.scope.describe", kind: "describe", source, run: () => ({ label: "Choose write scope" }) },
  fansArgs: { slot: "readings.fans.args", kind: "args", source, run: ctx => ({ work: ctx.work }) },
  sheetArgs: { slot: "readings.sheet.args", kind: "args", source, run: ctx => ({ fan: namesOf(ctx.page.fan), sheetPath: ctx.page.sheetPath, fans: ctx.readings.fans.value ?? null, work: ctx.work }) },
  sheetSnapshotArgs: { slot: "readings.sheetSnapshot.args", kind: "args", source, run: ctx => ({ sheet: ctx.readings.sheet.value ?? null, work: ctx.work }) },
  meshes: { slot: "readings.meshes.derive", kind: "derive", source, run: () => null },
  pickFans: { slot: "fields.fan.picker.options", kind: "picker", source, run: reading => (reading.value?.rows ?? []).map(row => ({ id: localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`), label: fanLabel(row, reading.value?.rows ?? []) })) },
} satisfies Omit<BodyBindings<typeof fansData, typeof schemas, typeof entries>, "seedSheet" | "price" | "sheetView" | "sheet-roster" | "sheet-inputs" | "sheet-picture" | "sheet-ledger">;
export const fansHostModule = { data: fansData, schemas, workState: fansRouteState, bodies: {} };

/** Carry only the destination subject and the document/fixture binding. */
export function fansLink(ids: readonly string[], search: Readonly<Record<string, unknown>>) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  params.set("fan", JSON.stringify({ kind: "ids", ids: ids.map(id => localId("ducts-fan", id)) }));
  return `/fans?${params}`;
}
