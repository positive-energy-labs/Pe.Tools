import {
  applyPatches,
  ductsSheetEditsSchema,
  fansDocumentSchema,
  fansRouteState,
  listSearchSchema,
  type FansRouteDocument,
} from "@pe/agent-contracts";
import { z } from "zod";
import type {
  BodyBindings,
  WorkPatch,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type {
  Immutable,
  RouteGraphJson,
} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import {
  entries as ductEntries,
  localId,
  namesOf,
  openSheetSchema,
  schemas as sharedSchemas,
} from "../ducts/neutral.ts";
import { fanLabel, TIERS } from "../ducts/sheet/model.ts";
import { describeInputHistory, editLabel } from "../ducts/sheet/input-history.ts";
import { editPatches } from "@pe/ducts-domain/sheet/index";

const workKeys = [
  "writeIntent",
  "calculation",
  "terminalDrops",
  "componentDrops",
  "esp",
  "equipmentFlows",
  "roles",
  "flows",
  "parameters",
  "designFriction",
] as const;
const pane = <const K extends string>(body: K, label: string, purpose: string) =>
  ({
    body,
    label,
    purpose,
    draws: ["fans", "sheet", "sheetSnapshot", "sheetView"],
    verbs: ["browse", "edit", "scope", "sheetEdit"],
  }) as const;

const pageField = <const R extends "pose" | "query", const K extends string, const V>(
  role: R,
  schema: K,
  initial: V,
  url: "push" | "replace",
) =>
  ({
    role,
    schema,
    codec: schema,
    initial,
    url,
    share: true,
    agent: "set",
  }) as const;
const readPolicy = {
  demand: "visible",
  retain: { evidence: "scope", resource: "scope" },
  refresh: "dependencies",
} as const;

const fanCell = <const K extends string>(key: K) =>
  ({
    segment: key,
    value: `${key}Cell` as const,
    groupOf: `group${key}` as const,
    deps: { page: [], work: [], readings: [] },
  }) as const;

export const fansData = {
  predicates: {},
  seeds: {
    scene: { title: "scene", load: "seedScene" },
    layout: { title: "layout", load: "seedLayout" },
    colours: { title: "colours", load: "seedColours" },
    navigation: { title: "navigation", load: "seedNavigation" },
  },
  address: "/fans",
  capabilities: ["work", "geometry"],
  cells: {
    calculation: fanCell("calculation"),
    terminalDrops: fanCell("terminalDrops"),
    componentDrops: fanCell("componentDrops"),
    esp: fanCell("esp"),
    equipmentFlows: fanCell("equipmentFlows"),
    roles: fanCell("roles"),
    flows: fanCell("flows"),
    parameters: fanCell("parameters"),
    designFriction: { ...fanCell("designFriction"), segment: null },
  },
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
  fields: {
    inputSort: pageField("query", "inputSort", "", "replace"),
    inputSearch: pageField("query", "inputSearch", { keywords: "", pills: [], v: 1 }, "replace"),
    contextRadiusFt: pageField("pose", "contextRadiusFt", 10, "replace"),
    contextStyle: pageField("pose", "contextStyle", "glass", "replace"),
    encoding: pageField("pose", "encoding", "health", "push"),
    fan: {
      role: "subject",
      schema: "fan",
      codec: "fan",
      initial: { ids: [], kind: "ids" },
      url: "push",
      share: true,
      agent: "set",
      cardinality: "many",
      identity: "fan",
      picker: { reading: "fans", options: "pickFans" },
    },
    layers: pageField(
      "pose",
      "layers",
      ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"],
      "push",
    ),
    picture: pageField("pose", "picture", "model", "push"),
    rosterSearch: pageField("query", "rosterSearch", { keywords: "", pills: [], v: 1 }, "replace"),
    rosterSort: pageField("query", "rosterSort", "", "replace"),
    sceneView: pageField("pose", "sceneView", { preset: "all", section: null }, "replace"),
    selected: { role: "selection", kinds: ["focus"] },
    sheetPath: pageField("query", "sheetPath", "", "replace"),
    stage: {
      role: "stage",
      schema: "sheetStage",
      codec: "stage",
      initial: "sheet",
      url: "push",
      share: true,
      agent: "set",
    },
    viewport: pageField("pose", "viewport", null, "replace"),
  },
  historyDetail: "historyDetail",
  identities: { fan: { codec: "local", kind: "local" }, focus: { codec: "local", kind: "local" } },
  key: "fans",
  layout: {
    axis: "h",
    children: [
      {
        axis: "v",
        children: [
          { id: "sheet-roster", kind: "pane" },
          { id: "sheet-inputs", kind: "pane" },
        ],
        id: "sheet-side",
        kind: "split",
        size: 360,
        sized: "end",
      },
      {
        axis: "v",
        children: [
          { id: "sheet-picture", kind: "pane" },
          { id: "sheet-ledger", kind: "pane" },
        ],
        id: "sheet-main",
        kind: "split",
        size: 360,
        sized: "start",
      },
    ],
    id: "sheet-layout",
    kind: "split",
    minOtherSize: 360,
    minSize: 280,
    rails: { start: { title: "Fans" } },
    size: 420,
    sized: "start",
  },
  name: "Fans",
  needs: "project",
  observe: [],
  panes: {
    "sheet-inputs": pane("sheet-inputs", "Inputs", "Edit fan inputs"),
    "sheet-ledger": pane("sheet-ledger", "Ledger", "Inspect ESP and provenance"),
    "sheet-picture": pane("sheet-picture", "Picture", "Inspect fan paths"),
    "sheet-roster": pane("sheet-roster", "Fans", "Open fan ports"),
  },
  readings: {
    fans: {
      args: "fansArgs",
      ...readPolicy,
      deps: { page: [], readings: [], work: workKeys },
      entry: "ducts.fans",
      kind: "use",
    },
    meshes: {
      ...readPolicy,
      deps: { page: [], readings: [], work: [] },
      derive: "meshes",
      kind: "derive",
      output: "snapshot",
    },
    pricing: {
      ...readPolicy,
      deps: { page: [], work: workKeys, readings: ["sheet"] },
      derive: "price",
      kind: "derive",
      output: "pricing",
    },
    sheet: {
      args: "sheetArgs",
      ...readPolicy,
      deps: { page: ["fan", "sheetPath"], readings: ["fans"], work: workKeys },
      entry: "ducts.sheet",
      kind: "use",
    },
    sheetSnapshot: {
      args: "sheetSnapshotArgs",
      ...readPolicy,
      deps: { page: [], readings: ["sheet"], work: workKeys },
      entry: "ducts.sheet-snapshot",
      kind: "use",
    },
    sheetView: {
      ...readPolicy,
      deps: { page: [], readings: ["sheet"], work: [] },
      derive: "sheetView",
      kind: "derive",
      output: "sheetView",
    },
  },
  resetOnTarget: [],
  stageOrder: ["sheet"],
  stages: {
    sheet: {
      panes: ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"],
      verbs: [],
      word: "Pricing fans",
    },
  },
  subject: { detail: "sheet", field: "fan", noun: "fan", pane: "sheet-roster", roster: "fans" },
  verbs: {
    browse: {
      captures: [],
      deps: { page: [], readings: [], work: [] },
      fields: ["sheetPath", "rosterSearch", "rosterSort", "inputSearch", "inputSort"],
      input: "browse",
      kind: "page",
      label: "Browse",
      patch: "browse",
      review: "none",
    },
    edit: {
      captures: [],
      deps: { page: [], readings: [], work: workKeys },
      describe: "describeEdit",
      input: "edit",
      kind: "work",
      label: "Edit",
      patches: "edit",
      review: "none",
    },
    scope: {
      captures: [],
      deps: { page: [], readings: [], work: workKeys },
      describe: "describeScope",
      input: "scope",
      kind: "work",
      label: "Choose write scope",
      patches: "scope",
      review: "none",
    },
    sheetEdit: {
      captures: [],
      deps: { page: [], readings: ["sheet"], work: workKeys },
      describe: "describeSheet",
      input: "sheetEdit",
      kind: "work",
      label: "Edit sheet inputs",
      patches: "sheetEdit",
      ready: "sheetReady",
      review: "none",
    },
  },
  version: 1,
  work: { schema: "work", route: "fans", version: 1, migrations: {} },
  workFields: { writeIntent: { label: "write scope", internal: true } },
} as const satisfies RouteGraphJson;
const rosterSort = z.enum(["", "name"]);
export const schemas = {
  contextRadiusFt: sharedSchemas.contextRadiusFt,
  contextStyle: sharedSchemas.contextStyle,
  encoding: sharedSchemas.encoding,
  fan: sharedSchemas.fan,
  historyDetail: sharedSchemas.historyDetail,
  inputSearch: sharedSchemas.inputSearch,
  inputSort: sharedSchemas.inputSort,
  layers: sharedSchemas.layers,
  picture: sharedSchemas.picture,
  sceneView: sharedSchemas.sceneView,
  sheet: sharedSchemas.sheet,
  sheetPath: sharedSchemas.sheetPath,
  sheetStage: sharedSchemas.sheetStage,
  snapshot: sharedSchemas.snapshot,
  pricing: sharedSchemas.pricing,
  viewport: sharedSchemas.viewport,
  edit: sharedSchemas.edit,
  sheetEdit: sharedSchemas.sheetEdit.extend({
    edits: ductsSheetEditsSchema.pick({
      flows: true,
      terminalDrops: true,
      componentDrops: true,
      esp: true,
      equipmentFlows: true,
      roles: true,
    }),
  }),
  work: fansDocumentSchema,
  scope: fansDocumentSchema.shape.writeIntent.unwrap().shape.edit.unwrap().unwrap().shape.value,
  browse: z.strictObject({
    inputSearch: sharedSchemas.inputSearch.optional(),
    inputSort: sharedSchemas.inputSort.optional(),
    sheetPath: z.string().optional(),
    rosterSearch: listSearchSchema.optional(),
    rosterSort: rosterSort.optional(),
  }),
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
const fanReadingSchema: z.ZodType<
  Immutable<z.output<(typeof ductEntries)["ducts.fans"]["output"]>>
> = ductEntries["ducts.fans"].output;
const sheetReadingSchema: z.ZodType<Immutable<z.output<typeof sharedSchemas.sheet>>> =
  sharedSchemas.sheet;
export const entries = {
  "ducts.fans": { ...ductEntries["ducts.fans"], input: z.object({ work: workSchema.nullable() }) },
  "ducts.sheet": {
    ...ductEntries["ducts.sheet"],
    input: ductEntries["ducts.sheet"].input.extend({
      work: workSchema.nullable(),
      fans: fanReadingSchema,
    }),
  },
  "ducts.sheet-snapshot": {
    ...ductEntries["ducts.sheet-snapshot"],
    input: ductEntries["ducts.sheet-snapshot"].input.extend({
      work: workSchema.nullable(),
      sheet: sheetReadingSchema,
    }),
  },
};
const source = { module: "fans/neutral.ts", export: "fansNeutralBodies" };
function patches(
  work: import("../../../../packages/agent-contracts/src/route-kernel-data.ts").Immutable<FansRouteDocument>,
  input: readonly import("@pe/agent-contracts").RouteStatePatch[],
): readonly WorkPatch<typeof fansDocumentSchema>[] {
  const next = applyPatches(
    fansRouteState,
    { version: 1, revision: 0, doc: work },
    "human",
    input,
    0,
    false,
    true,
  );
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
  return roots.filter((root) => input.some((patch) => patch.path[0] === root.path[0]));
}
const group = <const K extends string>(segment: K) => ({
  slot: `cells.${segment}.groupOf` as const,
  kind: "group" as const,
  source,
  run: (key: string) => [key],
});
export const fansNeutralBodies = {
  groupdesignFriction: group("designFriction"),
  groupparameters: group("parameters"),
  groupflows: group("flows"),
  grouproles: group("roles"),
  groupequipmentFlows: group("equipmentFlows"),
  groupcomponentDrops: group("componentDrops"),
  groupesp: group("esp"),
  groupterminalDrops: group("terminalDrops"),
  groupcalculation: group("calculation"),
  browse: { slot: "verbs.browse.patch", kind: "page", source, run: (_ctx, input) => input },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (ctx, input) => patches(ctx.work, input.patches),
  },
  describeEdit: {
    slot: "verbs.edit.describe",
    kind: "describe",
    source,
    run: (input) => describeInputHistory(input.history ?? { label: "Edit" }),
  },
  sheetEdit: {
    slot: "verbs.sheetEdit.patches",
    kind: "work",
    source,
    run: (ctx, input) => patches(ctx.work, editPatches(input.edits, null)),
  },
  sheetReady: {
    slot: "verbs.sheetEdit.ready",
    kind: "ready",
    source,
    run: (ctx, input) =>
      ctx.readings.sheet.current && input.basis === ctx.readings.sheet.value?.open?.overview.basis
        ? true
        : "Read the current sheet before editing its inputs",
  },
  describeSheet: {
    slot: "verbs.sheetEdit.describe",
    kind: "describe",
    source,
    run: (input) =>
      describeInputHistory(input.history ?? { label: editLabel(input.edits, () => null) }),
  },
  scope: {
    slot: "verbs.scope.patches",
    kind: "work",
    source,
    run: (_, input) => [{ path: ["writeIntent"], value: { edit: { value: input } } }],
  },
  describeScope: {
    slot: "verbs.scope.describe",
    kind: "describe",
    source,
    run: () => ({ label: "Choose write scope" }),
  },
  fansArgs: {
    slot: "readings.fans.args",
    kind: "args",
    source,
    run: (ctx) => ({ work: ctx.work }),
  },
  sheetArgs: {
    slot: "readings.sheet.args",
    kind: "args",
    source,
    run: (ctx) => ({
      fan: namesOf(ctx.page.fan),
      sheetPath: ctx.page.sheetPath,
      fans: ctx.readings.fans.value ?? null,
      work: ctx.work,
    }),
  },
  sheetSnapshotArgs: {
    slot: "readings.sheetSnapshot.args",
    kind: "args",
    source,
    run: (ctx) => ({ sheet: ctx.readings.sheet.value ?? null, work: ctx.work }),
  },
  meshes: { slot: "readings.meshes.derive", kind: "derive", source, run: () => null },
  pickFans: {
    slot: "fields.fan.picker.options",
    kind: "picker",
    source,
    run: (reading) =>
      (reading.value?.rows ?? []).map((row) => ({
        id: localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`),
        label: fanLabel(row, reading.value?.rows ?? []),
      })),
  },
} satisfies Omit<
  BodyBindings<typeof fansData, typeof schemas, typeof entries>,
  | "seedScene"
  | "seedLayout"
  | "seedColours"
  | "seedNavigation"
  | "price"
  | "sheetView"
  | "sheet-roster"
  | "sheet-inputs"
  | "sheet-picture"
  | "sheet-ledger"
>;
export const fansHostModule = { data: fansData, schemas, workState: fansRouteState, bodies: {} };

/** Carry only the destination subject and the document/fixture binding. */
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
