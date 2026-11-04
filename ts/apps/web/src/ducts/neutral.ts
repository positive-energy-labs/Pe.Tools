import type { DuctsRouteDocument } from "@pe/agent-contracts";
import {
applyPatches,
canonicalRouteInput,
commands,
dropFanCells,
ductCatalogReadingSchema,
ductsDesign,
ductsDocumentSchema,
ductsRosterResponseSchema,
ductsRouteState,
ductsSheetEditsSchema,
ductsSheetOverviewSchema,
ductsSheetResponseSchema,
neutralFansWork,
routeStatePatchSchema,
salvageDuctsWork,
type RouteStatePatch,
} from "@pe/agent-contracts";
import { ruleByKey,ruleWords } from "@pe/ducts-domain/loss-rules";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
import type {
BodyBindings,
BodyContext,
WorkPatch,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { Immutable,RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {
IdentityId,
Many,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { ductsAddress } from "../../../../packages/agent-contracts/src/routes/ducts.ts";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared.ts";
import { openSet } from "../shell/open-set.neutral.ts";
import { identityCodecs } from "../shell/page-port.ts";
import {
describeInputHistory,
editLabel,
editMetaSchema,
inputHistoryMetaSchema,
} from "./sheet/input-history.ts";

const detail = ductsSheetResponseSchema.options;
export const openSheetSchema = z.object({
  overview: ductsSheetOverviewSchema,
  inputs: detail[4].nullable(),
  elements: detail[2].nullable(),
  legs: detail[1].nullable(),
  worstLegs: z.array(detail[1]),
  worksheet: detail[3].nullable(),
});
export type OpenSheet = Immutable<z.output<typeof openSheetSchema>>;
const sheetReadingSchema = z.object({
  open: openSheetSchema.nullable(),
  opened: z.array(openSheetSchema).optional(),
  rows: ductsRosterResponseSchema.shape.rows,
  progress: z
    .object({ done: z.number(), total: z.number(), mark: z.string(), stopped: z.boolean() })
    .nullable(),
});
export type SheetReading = Immutable<z.output<typeof sheetReadingSchema>>;
const snapshotReadingSchema = z
  .preprocess(
    (raw) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const { sourceVersion, systemReads, ...snapshot } = raw as Record<string, unknown>;
      return { snapshot, sourceVersion, systemReads };
    },
    z.object({
      snapshot: nativeResponseSchema("ducts.snapshot.walk"),
      sourceVersion: z.string().optional(),
      systemReads: z
        .object({ completed: z.array(z.number()), missing: z.array(z.number()) })
        .optional(),
    }),
  )
  .transform(({ snapshot, ...capture }) => ({ ...snapshot, ...capture }));
export type SnapshotReading = z.output<typeof snapshotReadingSchema>;
const row = z.array(z.number());
const grid = z.object({
  title: z.string(),
  xLabel: z.string(),
  x: row,
  yLabel: z.string().optional(),
  y: row.optional(),
  zLabel: z.string().optional(),
  z: row.optional(),
  grid: z.union([row, z.array(row), z.array(z.array(row.nullable()))]),
});

const workKeys = [
  "criteria",
  "kinds",
  "writeIntent",
  "assumptions",
  "rules",
  "catalogs",
  "ruleAssignments",
  "subject",
  "claims",
  "labelParameter",
  "workingPhase",
  "systemColours",
] as const;
const fields = { ...threadListFields, ...ductsAddress.fields };
export const localId = (namespace: string, subject: string) =>
  JSON.stringify([namespace, subject]) as IdentityId<"local">;
// Identity decoding belongs to the declared local codec. Callers only pass accepted identities.
export const localSubject = (id: IdentityId<"local">): string => JSON.parse(id)[1];
/** The open set's active system by name: explicit, else the first open; under all, the roster's first. */
export const activeName = (value: Many<IdentityId<"local">>, roster: readonly string[]) => {
  const id = openSet(
    (id: IdentityId<"local">) => id,
    roster.map((name) => localId("ducts-system", name)),
  ).active(value);
  return id ? localSubject(id) : "";
};
export const namesOf = (value: Many<IdentityId<"local">>): string[] | "all" =>
  value.kind === "all" ? "all" : value.ids.map(localSubject);
const identity = z.string().transform((value, ctx) => {
  const decoded = identityCodecs.local.decode(value);
  if (decoded.ok) return decoded.value;
  ctx.addIssue({ code: "custom", message: decoded.reason });
  return z.NEVER;
});
const many = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ids"), ids: z.array(identity), active: identity.optional() }),
  z.strictObject({ kind: z.literal("all") }),
]);
export const schemas = {
  threadSearch: fields.threadSearch.schema,
  threadSort: fields.threadSort.schema,
  stage: fields.stage.schema,
  contextRadiusFt: fields.contextRadiusFt.schema,
  sceneView: fields.sceneView.schema,
  systemSearch: fields.systemSearch.schema,
  systemSort: fields.systemSort.schema,
  rulingSearch: fields.rulingSearch.schema,
  rulingSort: fields.rulingSort.schema,
  treeSearch: fields.treeSearch.schema,
  treeSort: fields.treeSort.schema,
  inputSearch: fields.inputSearch.schema,
  inputSort: fields.inputSort.schema,
  encoding: fields.encoding.schema,
  layers: fields.layers.schema,
  contextStyle: fields.contextStyle.schema,
  picture: fields.picture.schema,
  viewport: fields.viewport.schema,
  system: many,
  fan: many,
  sheetPath: z.string(),
  networkStage: z.enum(["network"]),
  sheetStage: z.enum(["sheet"]),
  assumptionsCell: ductsDocumentSchema.shape.assumptions.unwrap().valueType,
  rulesCell: ductsDocumentSchema.shape.rules.unwrap().valueType,
  catalogsCell: ductsDocumentSchema.shape.catalogs.unwrap().valueType,
  ruleAssignmentsCell: ductsDocumentSchema.shape.ruleAssignments.unwrap().valueType,
  kindsCell: ductsDocumentSchema.shape.kinds.unwrap().valueType,

  work: ductsDocumentSchema,
  historyDetail: inputHistoryMetaSchema,
  none: z.strictObject({}),
  placementRow: z.unknown(),
  browse: z
    .strictObject({
      threadSearch: fields.threadSearch.schema,
      threadSort: fields.threadSort.schema,
      systemSearch: fields.systemSearch.schema,
      systemSort: fields.systemSort.schema,
      rulingSearch: fields.rulingSearch.schema,
      rulingSort: fields.rulingSort.schema,
      treeSearch: fields.treeSearch.schema,
      treeSort: fields.treeSort.schema,
      inputSearch: fields.inputSearch.schema,
      inputSort: fields.inputSort.schema,
      sheetPath: z.string(),
    })
    .partial(),
  edit: z.strictObject({
    patches: z.array(routeStatePatchSchema),
    history: editMetaSchema.optional(),
  }),
  sheetEdit: z.strictObject({
    edits: ductsSheetEditsSchema,
    history: editMetaSchema.optional(),
    basis: z.string().nullable(),
  }),
  scope: ductsDocumentSchema.shape.writeIntent.unwrap().shape.edit.unwrap().unwrap().shape.value,
  snapshot: snapshotReadingSchema.nullable(),
  sheet: sheetReadingSchema.nullable(),
  pricing: z.unknown().nullable(),
  tables: z.record(z.string(), z.record(z.string(), grid)).nullable(),
  catalogs: ductCatalogReadingSchema.nullable(),
};
const axes = {
  subject: "Document",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const entries = {
  "ducts.roster": { input: schemas.none, output: schemas.snapshot, axes },
  "ducts.networks": {
    input: z.object({
      system: z.union([z.array(z.string()), z.literal("all")]),
      work: schemas.work.nullable(),
      roster: schemas.snapshot,
    }),
    output: schemas.snapshot,
    axes,
  },
  "ducts.tables": { input: schemas.none, output: schemas.tables, axes },
  "ducts.catalogs": { input: schemas.none, output: schemas.catalogs, axes },
  "ducts.fans": {
    input: z.object({ work: schemas.work.nullable() }),
    output: ductsRosterResponseSchema.nullable(),
    axes,
  },
  "ducts.sheet": {
    input: z.object({
      fan: z.union([z.array(z.string()), z.literal("all")]),
      sheetPath: z.string(),
      work: schemas.work.nullable(),
      fans: ductsRosterResponseSchema.nullable(),
    }),
    output: schemas.sheet,
    axes,
  },
  "ducts.sheet-snapshot": {
    input: z.object({ work: schemas.work.nullable(), sheet: schemas.sheet }),
    output: schemas.snapshot,
    axes,
  },
  "ducts.preview-losses": {
    input: commands["ducts.preview-losses"].input,
    output: commands["ducts.preview-losses"].result,
    axes: { ...commandCatalogAxes["ducts.preview-losses"], effect: "TransactRead" as const },
  },
  "ducts.preview-heal": {
    input: commands["ducts.preview-heal"].input,
    output: commands["ducts.preview-heal"].result,
    axes: { ...commandCatalogAxes["ducts.preview-heal"], effect: "TransactRead" as const },
  },
  "ducts.preview-assign-fan": {
    input: commands["ducts.preview-assign-fan"].input,
    output: commands["ducts.preview-assign-fan"].result,
    axes: { ...commandCatalogAxes["ducts.preview-assign-fan"], effect: "TransactRead" as const },
  },
  "ducts.apply-losses": {
    input: commands["ducts.apply-losses"].input,
    output: commands["ducts.apply-losses"].result,
    axes: { ...commandCatalogAxes["ducts.apply-losses"], effect: "ModelWrite" as const },
  },
  "ducts.apply-heal": {
    input: commands["ducts.apply-heal"].input,
    output: commands["ducts.apply-heal"].result,
    axes: { ...commandCatalogAxes["ducts.apply-heal"], effect: "ModelWrite" as const },
  },
  "ducts.apply-assign-fan": {
    input: commands["ducts.apply-assign-fan"].input,
    output: commands["ducts.apply-assign-fan"].result,
    axes: { ...commandCatalogAxes["ducts.apply-assign-fan"], effect: "ModelWrite" as const },
  },
};

// The route's existing pane/field/layout census is retained below. No legacy executable is loaded.
export const ductsData = {
  version: 1,
  key: "ducts",
  address: "/ducts",
  name: "Ducts",
  capabilities: ["work", "native-write", "geometry"],
  needs: "project",
  directory: {
    group: "Calculate loads & airflow",
    summary: "Review duct systems, stage inputs and rulings, and preview writes in Revit",
    label: "Pressure drop",
    icon: "Wind",
    exposure: "Main",
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
    aliases: ["duct", "pressure", "airflow", "systems"],
    runtimeNeed: "Revit for model reads and writes",
    listed: true,
    satellites: [],
    resume: "document",
  },
  identities: {
    system: {
      kind: "local",
      codec: "local",
    },
    fan: {
      kind: "local",
      codec: "local",
    },
    focus: {
      kind: "local",
      codec: "local",
    },
  },
  fields: {
    threadSearch: {
      role: "query",
      schema: "threadSearch",
      codec: "threadSearch",
      initial: {
        v: 1,
        keywords: "",
        pills: [
          {
            field: "scope",
            op: "=",
            value: "all",
          },
        ],
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    threadSort: {
      role: "query",
      schema: "threadSort",
      codec: "threadSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    stage: {
      role: "stage",
      schema: "networkStage",
      codec: "stage",
      initial: "network",
      url: "push",
      share: true,
      agent: "set",
    },
    contextRadiusFt: {
      role: "pose",
      schema: "contextRadiusFt",
      codec: "contextRadiusFt",
      initial: 10,
      url: "replace",
      share: true,
      agent: "set",
    },
    sceneView: {
      role: "pose",
      schema: "sceneView",
      codec: "sceneView",
      initial: {
        preset: "all",
        section: null,
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    system: {
      role: "subject",
      schema: "system",
      codec: "system",
      initial: {
        kind: "ids",
        ids: [],
      },
      url: "push",
      share: true,
      agent: "set",
      cardinality: "many",
      identity: "system",
      picker: {
        reading: "roster",
        options: "pickSystems",
      },
    },
    systemSearch: {
      role: "query",
      schema: "systemSearch",
      codec: "systemSearch",
      initial: {
        v: 1,
        keywords: "",
        pills: [],
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    systemSort: {
      role: "query",
      schema: "systemSort",
      codec: "systemSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    rulingSearch: {
      role: "query",
      schema: "rulingSearch",
      codec: "rulingSearch",
      initial: {
        v: 1,
        keywords: "",
        pills: [],
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    rulingSort: {
      role: "query",
      schema: "rulingSort",
      codec: "rulingSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    treeSearch: {
      role: "query",
      schema: "treeSearch",
      codec: "treeSearch",
      initial: {
        v: 1,
        keywords: "",
        pills: [],
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    treeSort: {
      role: "query",
      schema: "treeSort",
      codec: "treeSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    inputSearch: {
      role: "query",
      schema: "inputSearch",
      codec: "inputSearch",
      initial: {
        v: 1,
        keywords: "",
        pills: [],
      },
      url: "replace",
      share: true,
      agent: "set",
    },
    inputSort: {
      role: "query",
      schema: "inputSort",
      codec: "inputSort",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    encoding: {
      role: "pose",
      schema: "encoding",
      codec: "encoding",
      initial: "health",
      url: "push",
      share: true,
      agent: "set",
    },
    layers: {
      role: "pose",
      schema: "layers",
      codec: "layers",
      initial: ["meshes", "system-colours", "stub-labels", "halo", "no-run", "labels", "findings"],
      url: "push",
      share: true,
      agent: "set",
    },
    contextStyle: {
      role: "pose",
      schema: "contextStyle",
      codec: "contextStyle",
      initial: "glass",
      url: "replace",
      share: true,
      agent: "set",
    },
    picture: {
      role: "pose",
      schema: "picture",
      codec: "picture",
      initial: "model",
      url: "push",
      share: true,
      agent: "set",
    },
    viewport: {
      role: "pose",
      schema: "viewport",
      codec: "viewport",
      initial: null,
      url: "replace",
      share: true,
      agent: "set",
    },
    fan: {
      role: "query",
      schema: "fan",
      codec: "fan",
      initial: {
        kind: "ids",
        ids: [],
      },
      url: "push",
      share: true,
      agent: "set",
    },
    sheetPath: {
      role: "query",
      schema: "sheetPath",
      codec: "sheetPath",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    selected: {
      role: "selection",
      kinds: ["focus"],
    },
  },
  subject: {
    field: "system",
    noun: "system",
    roster: "roster",
    detail: "ducts",
    pane: "e-systems",
  },
  historyDetail: "historyDetail",
  work: {
    route: "ducts",
    schema: "work",
    version: 2,
    migrations: { "1": "dropFanCells" },
  },
  salvage: "salvage",
  readings: {
    roster: {
      kind: "use",
      entry: "ducts.roster",
      args: "rosterArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    ducts: {
      kind: "use",
      entry: "ducts.networks",
      args: "networksArgs",
      deps: {
        page: ["system"],
        work: workKeys,
        readings: ["roster"],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    tables: {
      kind: "use",
      entry: "ducts.tables",
      args: "tablesArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    catalogs: {
      kind: "use",
      entry: "ducts.catalogs",
      args: "catalogsArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    pricing: {
      kind: "derive",
      output: "pricing",
      derive: "price",
      deps: { page: [], work: workKeys, readings: ["ducts", "tables", "catalogs"] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "dependencies",
    },
    fans: {
      kind: "use",
      entry: "ducts.fans",
      args: "fansArgs",
      deps: {
        page: [],
        work: workKeys,
        readings: [],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    sheet: {
      kind: "use",
      entry: "ducts.sheet",
      args: "sheetArgs",
      deps: {
        page: ["fan", "sheetPath"],
        work: workKeys,
        readings: ["fans"],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    sheetSnapshot: {
      kind: "use",
      entry: "ducts.sheet-snapshot",
      args: "sheetSnapshotArgs",
      deps: {
        page: [],
        work: workKeys,
        readings: ["sheet"],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    meshes: {
      kind: "derive",
      output: "snapshot",
      derive: "meshes",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "visible",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "dependencies",
    },
    lossPreview: {
      kind: "use",
      entry: "ducts.preview-losses",
      args: "lossArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "explicit",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "explicit",
    },
    healPreview: {
      kind: "use",
      entry: "ducts.preview-heal",
      args: "healArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "explicit",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "explicit",
    },
    fanPreview: {
      kind: "use",
      entry: "ducts.preview-assign-fan",
      args: "fanArgs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      demand: "explicit",
      retain: {
        evidence: "scope",
        resource: "scope",
      },
      refresh: "explicit",
    },
  },
  verbs: {
    browse: {
      kind: "page",
      input: "browse",
      label: "Browse",
      review: "none",
      captures: [],
      deps: { page: [], work: [], readings: [] },
      patch: "browse",
      fields: [
        "threadSearch",
        "threadSort",
        "systemSearch",
        "systemSort",
        "rulingSearch",
        "rulingSort",
        "treeSearch",
        "treeSort",
        "inputSearch",
        "inputSort",
        "sheetPath",
      ],
    },
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit",
      review: "none",
      captures: [],
      deps: {
        page: [],
        work: workKeys,
        readings: [],
      },
      patches: "edit",
      describe: "describeEdit",
    },
    sheetEdit: {
      kind: "work",
      input: "sheetEdit",
      label: "Edit sheet inputs",
      review: "none",
      captures: [],
      deps: {
        page: [],
        work: workKeys,
        readings: ["sheet"],
      },
      patches: "sheetEdit",
      describe: "describeSheet",
      ready: "sheetReady",
    },
    scope: {
      kind: "work",
      input: "scope",
      label: "Choose write scope",
      review: "none",
      captures: [],
      deps: {
        page: [],
        work: workKeys,
        readings: [],
      },
      patches: "scope",
      describe: "describeScope",
    },
    losses: {
      kind: "command",
      input: "none",
      label: "Write to Revit",
      review: "shown",
      captures: ["ducts", "sheetSnapshot", "sheet"],
      deps: {
        page: ["stage", "system", "fan"],
        work: workKeys,
        readings: ["ducts", "sheetSnapshot", "sheet"],
      },
      entry: "ducts.apply-losses",
      intent: "losses",
      ready: "lossReady",
      present: "presentLosses",
    },
    heal: {
      kind: "command",
      input: "none",
      label: "Heal",
      review: "shown",
      captures: ["ducts", "sheetSnapshot", "sheet"],
      deps: {
        page: ["stage", "system", "fan"],
        work: workKeys,
        readings: ["ducts", "sheetSnapshot", "sheet"],
      },
      entry: "ducts.apply-heal",
      intent: "heal",
      ready: "healReady",
      present: "presentHeal",
    },
    assign: {
      kind: "command",
      input: "none",
      label: "Make the fan",
      review: "shown",
      captures: ["ducts", "sheetSnapshot", "sheet"],
      deps: {
        page: ["stage", "system", "fan"],
        work: workKeys,
        readings: ["ducts", "sheetSnapshot", "sheet"],
      },
      entry: "ducts.apply-assign-fan",
      intent: "assign",
      ready: "fanReady",
      present: "presentFan",
    },
  },
  panes: {
    "e-systems": {
      label: "Systems",
      purpose: "Choose a system to inspect",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-systems",
    },
    "e-sidebar": {
      label: "System tree",
      purpose: "Inspect the opened systems and their runs",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-sidebar",
    },
    "e-rules-all": {
      label: "All-systems rules",
      purpose: "Price every read fitting type",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-rules-all",
    },
    "e-rules": {
      label: "This system's rules",
      purpose: "Review fitting rules for the opened systems",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-rules",
    },
    "e-picture": {
      label: "Picture",
      purpose: "Inspect the model or schematic",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-picture",
    },
    "e-inbox": {
      label: "Rulings",
      purpose: "Review assumptions and planned writes",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
      body: "e-inbox",
    },
  },
  layout: {
    kind: "split",
    id: "sidebar",
    axis: "h",
    sized: "start",
    size: 420,
    minSize: 280,
    maxSize: 760,
    minOtherSize: 360,
    rails: {
      start: {
        title: "Systems",
      },
    },
    children: [
      {
        kind: "split",
        id: "stack",
        axis: "v",
        sized: "end",
        size: 300,
        children: [
          {
            kind: "split",
            id: "scope-upper",
            axis: "v",
            sized: "start",
            size: 240,
            children: [
              {
                kind: "pane",
                id: "e-systems",
              },
              {
                kind: "gate",
                when: "system",
                child: {
                  kind: "pane",
                  id: "e-sidebar",
                },
              },
            ],
          },
          {
            kind: "split",
            id: "scope-lower",
            axis: "v",
            sized: "start",
            size: 176,
            children: [
              {
                kind: "pane",
                id: "e-rules-all",
              },
              {
                kind: "gate",
                when: "system",
                child: {
                  kind: "pane",
                  id: "e-rules",
                },
              },
            ],
          },
        ],
      },
      {
        kind: "split",
        id: "drawing",
        axis: "h",
        sized: "end",
        size: 340,
        minSize: 260,
        maxSize: 520,
        minOtherSize: 360,
        rails: {
          end: {
            title: "Rulings",
          },
        },
        children: [
          {
            kind: "pane",
            id: "e-picture",
          },
          {
            kind: "pane",
            id: "e-inbox",
          },
        ],
      },
    ],
  },
  stages: {
    network: {
      word: "Pricing systems",
      panes: [
        "e-systems",
        "e-sidebar",
        "e-rules-all",
        "e-rules",
        "e-picture",
        "e-inbox",
      ],
      verbs: ["losses", "heal", "assign"],
    },
  },
  stageOrder: ["network"],
  predicates: {
    system: "hasSystem",
  },
  cells: {
    assumptions: {
      segment: "assumptions",
      value: "assumptionsCell",
      groupOf: "groupassumptions",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelassumptions",
    },
    rules: {
      segment: "rules",
      value: "rulesCell",
      groupOf: "grouprules",
      label: "labelrules",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
    },
    catalogs: {
      segment: "catalogs",
      value: "catalogsCell",
      groupOf: "groupcatalogs",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelcatalogs",
    },
    ruleAssignments: {
      segment: "ruleAssignments",
      value: "ruleAssignmentsCell",
      groupOf: "groupruleAssignments",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelruleAssignments",
    },
    kinds: {
      segment: "kinds",
      value: "kindsCell",
      groupOf: "groupkinds",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelkinds",
    },
  },
  workFields: {
    subject: {
      label: "system membership",
      internal: false,
    },
    claims: {
      label: "element claims",
      internal: false,
    },
    labelParameter: {
      label: "label parameter",
      internal: false,
    },
    workingPhase: {
      label: "working phase",
      internal: false,
    },
    systemColours: {
      label: "system colours",
      internal: false,
    },
    writeIntent: {
      label: "write scope",
      internal: true,
    },
    criteria: {
      label: "design criteria",
      internal: false,
    },
  },
  seeds: {
    scene: { title: "scene", load: "seedScene" },
    layout: { title: "layout", load: "seedLayout" },
    colours: { title: "colours", load: "seedColours" },
    navigation: { title: "navigation", load: "seedNavigation" },
  },
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;

type CommandContext = BodyContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  typeof ductsData.verbs.losses
>;
type ScopeEvidence = Omit<CommandContext, "page"> & {
  readonly page: Omit<CommandContext["page"], "stage"> & { readonly stage: string };
};
const selectedGroups = (ctx: ScopeEvidence) => {
  // Domain readonly sweep reached 28 files; DuctSnapshot still requires mutable arrays.
  const snapshot = ctx.readings.ducts.value as DuctSnapshot | null;
  const active = activeName(ctx.page.system, snapshot?.systems.map((system) => system.name) ?? []);
  return snapshot && active ? systemScope(snapshot, active).groups : [];
};
const lossReady = (ctx: ScopeEvidence): true | string => {
  const intent = ctx.work.writeIntent.edit?.value;
  // U4: the fan walk scope is fans Work; until it is wired a sheet preview is never ready.
  if (ctx.page.stage === "sheet") return "Choose this fan's write scope before previewing";
  const groups = selectedGroups(ctx);
  return groups.length && canonicalRouteInput(intent?.groups) === canonicalRouteInput(groups)
    ? true
    : "Choose the active system's write scope before previewing";
};
const source = { module: "ducts/neutral.ts", export: "neutralBodies" };
const records = new Set([
  "assumptions",
  "rules",
  "catalogs",
  "ruleAssignments",
  "kinds",
  "subject",
  "claims",
]);
/** Validate authored patch values, then return the bounded root/record-entry patches the admitted door accepts. */
export function authoredPatches(
  work: DuctsRouteDocument,
  patches: readonly RouteStatePatch[],
): readonly WorkPatch<typeof ductsDocumentSchema>[] {
  // Materialize without stamping: the accepting host owns author, clock and revision.
  const next = applyPatches(
    ductsRouteState,
    { version: 1, revision: 0, doc: work },
    "human",
    patches,
    0,
    false,
    true,
  );
  if (!next.ok) throw Error(next.error);
  const paths = [
    ...new Map(
      patches.map((patch) => {
        const path =
          records.has(String(patch.path[0])) && patch.path.length > 1
            ? patch.path.slice(0, 2)
            : patch.path.slice(0, 1);
        return [JSON.stringify(path), path] as const;
      }),
    ).values(),
  ];
  return paths.map((path) => {
    const root = next.envelope.doc[path[0] as keyof DuctsRouteDocument];
    const value = path.length === 1 ? root : (root as Record<string, unknown>)[String(path[1])];
    return value === undefined ? { path, op: "delete" } : { path, value };
  }) as unknown as readonly WorkPatch<typeof ductsDocumentSchema>[];
}
const dropFanCellsBody = {
  slot: "work.migrations.1",
  kind: "migration",
  source,
  run: dropFanCells,
} as const;
export const neutralBodies = {
  dropFanCells: dropFanCellsBody,
  browse: { slot: "verbs.browse.patch", kind: "page", source, run: (_ctx, input) => input },
  labelassumptions: {
    slot: "cells.assumptions.label",
    kind: "label",
    source,
    run: () => "duct assumptions",
  },
  labelcatalogs: {
    slot: "cells.catalogs.label",
    kind: "label",
    source,
    run: () => "grille catalog links",
  },
  labelruleAssignments: {
    slot: "cells.ruleAssignments.label",
    kind: "label",
    source,
    run: () => "fitting rule assignments",
  },
  labelkinds: { slot: "cells.kinds.label", kind: "label", source, run: () => "unit kinds" },
  groupassumptions: {
    slot: "cells.assumptions.groupOf",
    kind: "group",
    source,
    run: (key) => [key.split(":")[0] ?? key],
  },
  labelrules: {
    slot: "cells.rules.label",
    kind: "label",
    source,
    run: (key) => {
      const rule = ruleByKey(key);
      return rule ? ruleWords(rule) : key;
    },
  },
  grouprules: { slot: "cells.rules.groupOf", kind: "group", source, run: (key) => [key] },
  groupcatalogs: { slot: "cells.catalogs.groupOf", kind: "group", source, run: (key) => [key] },
  groupruleAssignments: {
    slot: "cells.ruleAssignments.groupOf",
    kind: "group",
    source,
    run: (key) => [key],
  },
  groupkinds: { slot: "cells.kinds.groupOf", kind: "group", source, run: (key) => [key] },
  rosterArgs: { slot: "readings.roster.args", kind: "args", source, run: () => ({}) },
  networksArgs: {
    slot: "readings.ducts.args",
    kind: "args",
    source,
    // readonly at the contract owner after U2 lands
    run: (ctx) =>
      ({
        system: namesOf(ctx.page.system),
        roster: ctx.readings.roster.value ?? null,
        work: ctx.work,
      }) as z.output<(typeof entries)["ducts.networks"]["input"]>,
  },
  tablesArgs: { slot: "readings.tables.args", kind: "args", source, run: () => ({}) },
  catalogsArgs: { slot: "readings.catalogs.args", kind: "args", source, run: () => ({}) },
  fansArgs: {
    slot: "readings.fans.args",
    kind: "args",
    source,
    // readonly at the contract owner after U2 lands
    run: (ctx) => ({ work: ctx.work }) as z.output<(typeof entries)["ducts.fans"]["input"]>,
  },
  sheetArgs: {
    slot: "readings.sheet.args",
    kind: "args",
    source,
    // readonly at the contract owner after U2 lands
    run: (ctx) =>
      ({
        fan: namesOf(ctx.page.fan),
        sheetPath: ctx.page.sheetPath,
        fans: ctx.readings.fans.value ?? null,
        work: ctx.work,
      }) as z.output<(typeof entries)["ducts.sheet"]["input"]>,
  },
  sheetSnapshotArgs: {
    slot: "readings.sheetSnapshot.args",
    kind: "args",
    source,
    // readonly at the contract owner after U2 lands
    run: (ctx) =>
      ({ work: ctx.work, sheet: ctx.readings.sheet.value ?? null }) as z.output<
        (typeof entries)["ducts.sheet-snapshot"]["input"]
      >,
  },
  meshes: { slot: "readings.meshes.derive", kind: "derive", source, run: () => null },
  pickSystems: {
    slot: "fields.system.picker.options",
    kind: "picker",
    source,
    run: (reading) =>
      (reading.value?.systems ?? []).map((system) => ({
        id: localId("ducts-system", system.name),
        label: system.name,
      })),
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    // readonly at the contract owner after U2 lands
    run: (ctx, input) => authoredPatches(ctx.work as DuctsRouteDocument, input.patches),
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
    // readonly at the contract owner after U2 lands
    run: (ctx, input) =>
      authoredPatches(
        ctx.work as DuctsRouteDocument,
        // U4 wires the real fans Work here; a fan-cell edit refuses at the ducts schema until then.
        editPatches(input.edits, ductsDesign(ctx.work as DuctsRouteDocument, neutralFansWork)),
      ),
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
  lossArgs: { slot: "readings.lossPreview.args", kind: "args", source, run: () => null },
  healArgs: { slot: "readings.healPreview.args", kind: "args", source, run: () => null },
  fanArgs: { slot: "readings.fanPreview.args", kind: "args", source, run: () => null },
  losses: { slot: "verbs.losses.intent", kind: "intent", source, run: () => ({}) },
  heal: { slot: "verbs.heal.intent", kind: "intent", source, run: () => ({}) },
  assign: { slot: "verbs.assign.intent", kind: "intent", source, run: () => ({}) },
  lossReady: { slot: "verbs.losses.ready", kind: "ready", source, run: lossReady },
  healReady: {
    slot: "verbs.heal.ready",
    kind: "ready",
    source,
    run: (ctx: ScopeEvidence) => {
      const groups = ctx.work.writeIntent.edit?.value.groups;
      const selected = selectedGroups(ctx);
      return groups?.length && groups.every((group) => selected.includes(group))
        ? true
        : "Choose repair groups in the active system";
    },
  },
  fanReady: {
    slot: "verbs.assign.ready",
    kind: "ready",
    source,
    run: (ctx: ScopeEvidence) => {
      const fan = ctx.work.writeIntent.edit?.value.fan;
      const snapshot = ctx.readings.ducts.value;
      const active = activeName(
        ctx.page.system,
        snapshot?.systems.map((system) => system.name) ?? [],
      );
      return fan && snapshot?.systems.find((system) => system.id === fan.systemId)?.name === active
        ? true
        : "Choose the fan and active system";
    },
  },
  hasSystem: {
    slot: "predicates.system",
    kind: "predicate",
    source,
    run: (ctx: { page: { system: Many<IdentityId<"local">> } }) =>
      ctx.page.system.kind === "all" || ctx.page.system.ids.length > 0,
  },
  salvage: {
    slot: "salvage",
    kind: "salvage",
    source,
    run: (raw) => ({
      ok: true,
      value: Object.entries(salvageDuctsWork(raw).doc).map(([key, value]) => ({
        path: [key],
        value,
      })) as readonly WorkPatch<typeof ductsDocumentSchema>[],
    }),
  },
} satisfies Omit<
  BodyBindings<typeof ductsData, typeof schemas, typeof entries>,
  | "price"
  | "e-systems"
  | "e-sidebar"
  | "e-rules-all"
  | "e-rules"
  | "e-picture"
  | "e-inbox"
  | "presentLosses"
  | "presentHeal"
  | "presentFan"
  | "seedScene"
  | "seedLayout"
  | "seedColours"
  | "seedNavigation"
>;

export const ductsHostModule = {
  data: ductsData,
  schemas,
  workState: ductsRouteState,
  bodies: {
    salvage: { slot: "salvage", kind: "recovery" as const, source, run: ductsRouteState.salvage },
    dropFanCells: dropFanCellsBody,
  },
};

/** Carry only the destination subject and the document/fixture binding. */
export function ductsLink(ids: readonly string[], search: Readonly<Record<string, unknown>>) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  params.set("system", JSON.stringify({ kind: "ids", ids: ids.map(id => localId("ducts-system", id)) }));
  return `/ducts?${params}`;
}
