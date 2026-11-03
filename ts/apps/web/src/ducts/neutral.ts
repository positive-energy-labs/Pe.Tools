import { z } from "zod";
import { identityCodecs } from "../shell/page-port.ts";
import {
  applyPatches,
  canonicalRouteInput,
  commands,
  ductsDocumentSchema,
  ductsRouteState,
  ductsRosterResponseSchema,
  ductsSheetEditsSchema,
  routeStatePatchSchema,
  salvageDuctsWork,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import type { DuctsRouteDocument, DuctsSheetOverview } from "@pe/agent-contracts";
import type { Detail, FanPort } from "./sheet/model.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {
  BodyBindings,
  BodyContext,
  WorkPatch,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type {
  IdentityId,
  Many,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { ductsAddress } from "../../../../packages/agent-contracts/src/routes/ducts.ts";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared.ts";
import {
  describeInputHistory,
  editLabel,
  editMetaSchema,
  inputHistoryMetaSchema,
} from "./sheet/input-history.ts";

export type OpenSheet = {
  overview: DuctsSheetOverview;

  inputs: Detail<"inputs"> | null;

  elements: Detail<"elements"> | null;

  legs: Detail<"legs"> | null;

  worstLegs: Detail<"legs">[];

  worksheet: Detail<"worksheet"> | null;
};

export type SheetReading = {
  open: OpenSheet | null;
  opened?: OpenSheet[];
  rows: FanPort[];
  progress: { done: number; total: number; mark: string; stopped: boolean } | null;
};

export type SnapshotReading = DuctSnapshot & { sourceVersion?: string };

const workKeys = [
  "criteria",
  "kinds",
  "writeIntent",
  "calculation",
  "assumptions",
  "rules",
  "catalogs",
  "ruleAssignments",
  "terminalDrops",
  "componentDrops",
  "esp",
  "equipmentFlows",
  "roles",
  "loads",
  "flows",
  "parameters",
  "subject",
  "claims",
  "labelParameter",
  "workingPhase",
  "designFriction",
  "systemColours",
] as const;
const fields = { ...threadListFields, ...ductsAddress.fields };
export const localId = (namespace: string, subject: string) =>
  JSON.stringify([namespace, subject]) as IdentityId<"local">;
// Identity decoding belongs to the declared local codec. Callers only pass accepted identities.
export const localSubject = (id: IdentityId<"local">): string => JSON.parse(id)[1];
export const namesOf = (value: Many<IdentityId<"local">>): string[] | "all" =>
  value.kind === "all" ? "all" : value.ids.map(localSubject);
const identity = z.custom<IdentityId<"local">>(
  (value) => typeof value === "string" && identityCodecs.local.decode(value).ok,
);
const many = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ids"), ids: z.array(identity) }),
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
  calculationCell: ductsDocumentSchema.shape.calculation.unwrap().valueType,
  assumptionsCell: ductsDocumentSchema.shape.assumptions.unwrap().valueType,
  rulesCell: ductsDocumentSchema.shape.rules.unwrap().valueType,
  catalogsCell: ductsDocumentSchema.shape.catalogs.unwrap().valueType,
  ruleAssignmentsCell: ductsDocumentSchema.shape.ruleAssignments.unwrap().valueType,
  terminalDropsCell: ductsDocumentSchema.shape.terminalDrops.unwrap().valueType,
  componentDropsCell: ductsDocumentSchema.shape.componentDrops.unwrap().valueType,
  flowsCell: ductsDocumentSchema.shape.flows.unwrap().valueType,
  espCell: ductsDocumentSchema.shape.esp.unwrap().valueType,
  equipmentFlowsCell: ductsDocumentSchema.shape.equipmentFlows.unwrap().valueType,
  rolesCell: ductsDocumentSchema.shape.roles.unwrap().valueType,
  parametersCell: ductsDocumentSchema.shape.parameters.unwrap().valueType,
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
  snapshot: z.custom<SnapshotReading>().nullable(),
  sheet: z.custom<SheetReading>().nullable(),
  pricing: z.unknown().nullable(),
  tables: z.custom<Grids>().nullable(),
  catalogs: z.custom<{ tables: Catalogs; findings: string[] }>().nullable(),
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
    version: 1,
    migrations: {},
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
      verbs: {
        choose: "placeESystems",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-systems",
    },
    "e-sidebar": {
      label: "System tree",
      purpose: "Inspect the opened systems and their runs",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeESidebar",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-sidebar",
    },
    "e-inputs": {
      label: "Inputs",
      purpose: "Edit flow, ESP, role and drop",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeEInputs",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-inputs",
    },
    "e-rules-all": {
      label: "All-systems rules",
      purpose: "Price every read fitting type",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeERulesAll",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-rules-all",
    },
    "e-rules": {
      label: "This system's rules",
      purpose: "Review fitting rules for the opened systems",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeERules",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-rules",
    },
    "e-picture": {
      label: "Picture",
      purpose: "Inspect the model or schematic",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeEPicture",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
      body: "e-picture",
    },
    "e-inbox": {
      label: "Rulings",
      purpose: "Review assumptions and planned writes",
      draws: ["fans", "roster", "ducts", "tables", "catalogs", "pricing", "meshes"],
      verbs: {
        choose: "placeEInbox",
        allowed: ["browse", "edit", "sheetEdit", "scope", "losses", "heal", "assign"],
        row: "placementRow",
      },
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
                  kind: "split",
                  id: "inputs",
                  axis: "v",
                  sized: "end",
                  size: 220,
                  children: [
                    {
                      kind: "pane",
                      id: "e-sidebar",
                    },
                    {
                      kind: "pane",
                      id: "e-inputs",
                    },
                  ],
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
        "e-inputs",
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
    calculation: {
      segment: "calculation",
      value: "calculationCell",
      groupOf: "groupcalculation",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelcalculation",
    },
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
    terminalDrops: {
      segment: "terminalDrops",
      value: "terminalDropsCell",
      groupOf: "groupterminalDrops",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelterminalDrops",
    },
    componentDrops: {
      segment: "componentDrops",
      value: "componentDropsCell",
      groupOf: "groupcomponentDrops",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelcomponentDrops",
    },
    flows: {
      segment: "flows",
      value: "flowsCell",
      groupOf: "groupflows",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelflows",
    },
    esp: {
      segment: "esp",
      value: "espCell",
      groupOf: "groupesp",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelesp",
    },
    equipmentFlows: {
      segment: "equipmentFlows",
      value: "equipmentFlowsCell",
      groupOf: "groupequipmentFlows",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelequipmentFlows",
    },
    roles: {
      segment: "roles",
      value: "rolesCell",
      groupOf: "grouproles",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelroles",
    },
    parameters: {
      segment: "parameters",
      value: "parametersCell",
      groupOf: "groupparameters",
      deps: {
        page: [],
        work: [],
        readings: [],
      },
      label: "labelparameters",
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
    loads: {
      label: "loads",
      internal: false,
    },
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
    designFriction: {
      label: "design friction",
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
  seeds: {},
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
  const systems = namesOf(ctx.page.system);
  const snapshot = ctx.readings.ducts.value as DuctSnapshot | null;
  const active = systems === "all" ? snapshot?.systems.at(-1)?.name : systems.at(-1);
  return snapshot && active ? systemScope(snapshot, active).groups : [];
};
const lossReady = (ctx: ScopeEvidence): true | string => {
  const intent = ctx.work.writeIntent.edit?.value;
  if (ctx.page.stage === "sheet") {
    const sheet = ctx.readings.sheet;
    const fan = sheet.value?.open?.overview.fan;
    return sheet.current &&
      fan &&
      (sheet.value?.opened?.length ?? 1) <= 1 &&
      intent?.walk?.unitId === fan.unitId &&
      intent.walk.portIndex === fan.portIndex
      ? true
      : "Choose this fan's write scope before previewing";
  }
  const groups = selectedGroups(ctx);
  return groups.length && canonicalRouteInput(intent?.groups) === canonicalRouteInput(groups)
    ? true
    : "Choose the active system's write scope before previewing";
};
const source = { module: "ducts/neutral.ts", export: "neutralBodies" };
const records = new Set([
  "calculation",
  "assumptions",
  "rules",
  "catalogs",
  "ruleAssignments",
  "terminalDrops",
  "componentDrops",
  "esp",
  "equipmentFlows",
  "roles",
  "kinds",
  "loads",
  "flows",
  "parameters",
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
const noRowCommands = () => [] as const;
export const neutralBodies = {
  browse: { slot: "verbs.browse.patch", kind: "page", source, run: (_ctx, input) => input },
  labelcalculation: {
    slot: "cells.calculation.label",
    kind: "label",
    source,
    run: () => "calculation evidence",
  },
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
  labelterminalDrops: {
    slot: "cells.terminalDrops.label",
    kind: "label",
    source,
    run: () => "terminal drops",
  },
  labelcomponentDrops: {
    slot: "cells.componentDrops.label",
    kind: "label",
    source,
    run: () => "component drops",
  },
  labelflows: { slot: "cells.flows.label", kind: "label", source, run: () => "terminal flows" },
  labelesp: { slot: "cells.esp.label", kind: "label", source, run: () => "unit ESP" },
  labelequipmentFlows: {
    slot: "cells.equipmentFlows.label",
    kind: "label",
    source,
    run: () => "unit flows",
  },
  labelroles: { slot: "cells.roles.label", kind: "label", source, run: () => "unit roles" },
  labelparameters: {
    slot: "cells.parameters.label",
    kind: "label",
    source,
    run: () => "parameter slots",
  },
  labelkinds: { slot: "cells.kinds.label", kind: "label", source, run: () => "unit kinds" },
  placeESystems: {
    slot: "panes.e-systems.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeESidebar: {
    slot: "panes.e-sidebar.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeEInputs: {
    slot: "panes.e-inputs.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeERulesAll: {
    slot: "panes.e-rules-all.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeERules: {
    slot: "panes.e-rules.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeEPicture: {
    slot: "panes.e-picture.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  placeEInbox: {
    slot: "panes.e-inbox.verbs.choose",
    kind: "placement",
    source,
    run: noRowCommands,
  },
  groupcalculation: {
    slot: "cells.calculation.groupOf",
    kind: "group",
    source,
    run: (key) => [key],
  },
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
  groupterminalDrops: {
    slot: "cells.terminalDrops.groupOf",
    kind: "group",
    source,
    run: (key) => [key],
  },
  groupcomponentDrops: {
    slot: "cells.componentDrops.groupOf",
    kind: "group",
    source,
    run: (key) => [key],
  },
  groupflows: { slot: "cells.flows.groupOf", kind: "group", source, run: (key) => [key] },
  groupesp: { slot: "cells.esp.groupOf", kind: "group", source, run: (key) => [key] },
  groupequipmentFlows: {
    slot: "cells.equipmentFlows.groupOf",
    kind: "group",
    source,
    run: (key) => [key],
  },
  grouproles: { slot: "cells.roles.groupOf", kind: "group", source, run: (key) => [key] },
  groupparameters: { slot: "cells.parameters.groupOf", kind: "group", source, run: (key) => [key] },
  groupkinds: { slot: "cells.kinds.groupOf", kind: "group", source, run: (key) => [key] },
  rosterArgs: { slot: "readings.roster.args", kind: "args", source, run: () => ({}) },
  networksArgs: {
    slot: "readings.ducts.args",
    kind: "args",
    source,
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
    run: (ctx) => ({ work: ctx.work }) as z.output<(typeof entries)["ducts.fans"]["input"]>,
  },
  sheetArgs: {
    slot: "readings.sheet.args",
    kind: "args",
    source,
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
    run: (ctx, input) => authoredPatches(ctx.work as DuctsRouteDocument, input.patches),
  },
  describeEdit: {
    slot: "verbs.edit.describe",
    kind: "describe",
    source,
    run: (input) => describeInputHistory({}, input.history ?? { label: "Edit" }),
  },
  sheetEdit: {
    slot: "verbs.sheetEdit.patches",
    kind: "work",
    source,
    run: (ctx, input) =>
      authoredPatches(
        ctx.work as DuctsRouteDocument,
        editPatches(input.edits, ctx.work as DuctsRouteDocument),
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
    run: (input, ctx) =>
      describeInputHistory(
        ctx.readings,
        input.history ?? { label: editLabel(input.edits, () => null) },
      ),
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
    run: () => ({
      label: "Choose write scope",
      meta: { kind: "ducts-input" as const, effect: { before: null } },
    }),
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
      const systems = namesOf(ctx.page.system);
      const active = systems === "all" ? snapshot?.systems.at(-1)?.name : systems.at(-1);
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
  | "e-inputs"
  | "e-rules-all"
  | "e-rules"
  | "e-picture"
  | "e-inbox"
  | "presentLosses"
  | "presentHeal"
  | "presentFan"
>;

export const ductsHostModule = {
  data: ductsData,
  schemas,
  workState: ductsRouteState,
  bodies: {
    salvage: { slot: "salvage", kind: "recovery" as const, source, run: ductsRouteState.salvage },
  },
};
