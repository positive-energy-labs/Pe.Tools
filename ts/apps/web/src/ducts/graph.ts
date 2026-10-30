import { field } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";

import {
  pane,
  split,
  gate,
  routeAddress,
  ductsDocumentSchema as ductsRouteSchema,
  ductsApplyInputSchema,
  ductsHealInputSchema,
  ductsAssignFanInputSchema,
  type RouteGraph,
  type CellsDecl,
  type DuctsRouteDocument,
  type DuctAssumption,
  routeStatePatchSchema,
  ductsSheetEditsSchema,
} from "@pe/agent-contracts";

import { ductsAddress } from "../../../../packages/agent-contracts/src/routes/ducts";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";

import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";

import { cellFocus } from "./inbox-rows";

import { capped } from "./selection";

import { editPatches } from "@pe/ducts-domain/sheet/index";
import { CRITERION_WORDS } from "./sheet/criterion-words";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { commandVerb, workVerb, prepareCommand } from "#/shell/verbs";

const fields = { ...threadListFields, ...ductsAddress.fields };

const fanPort = z
  .strictObject({ unitId: z.number().int(), portIndex: z.number().int() })
  .nullable()
  .default(null);

const jsonCodec = {
  encode: (value: unknown) => JSON.stringify(value),
  decode: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
};

const transient = <S extends z.ZodType>(schema: S) => ({
  ...field(schema, {}, jsonCodec),
  role: "transient" as const,
  url: false as const,
});

export const ductsPageSchema = routeAddress("ducts").schema.extend({
  fanPort,
  sheetPath: z.string().default(""),
  readAll: z.boolean().default(false),
  allFans: z.boolean().default(false),
});
export type DuctsPage = { [K in keyof typeof fields]: z.output<(typeof fields)[K]["schema"]> } & {
  fanPort: z.output<typeof fanPort>;
  sheetPath: string;
  readAll: boolean;
  allFans: boolean;
};

const requestInput = <S extends z.ZodType>(request: S) =>
  z.strictObject({ request: request.optional(), refusal: z.string().nullable().default(null) });

const priceInput = requestInput(ductsApplyInputSchema);

const healInput = requestInput(ductsHealInputSchema);

const assignInput = requestInput(ductsAssignFanInputSchema);

const none = z.strictObject({}).default({});

const requestReady = (_: unknown, input: { request?: unknown; refusal: string | null }) =>
  input.refusal ?? (input.request ? null : "Read this document before writing");

const ductCells = (families: CellsDecl<DuctsRouteDocument>[]): CellsDecl<DuctsRouteDocument>[] =>
  families.map((family) => {
    const { segment } = family;

    if (segment === null) return family;

    return {
      ...family,

      focus: (key) => ({ issue: cellFocus(segment, key) }),

      ...(segment === "rules"
        ? {
            label: (group) => {
              const rule = ruleByKey(group);

              return rule ? ruleWords(rule) : group;
            },
          }
        : {}),
    };
  });

export const ductsGraph: RouteGraph<DuctsPage, DuctsRouteDocument> = {
  key: "ducts",
  address: "ducts",
  name: "Ducts",
  work: ductsRouteSchema,
  needs: "project",

  fields: {
    threadSearch: { ...fields.threadSearch, role: "query", url: fields.threadSearch.url },
    threadSort: { ...fields.threadSort, role: "query", url: fields.threadSort.url },
    stage: { ...fields.stage, role: "stage", url: fields.stage.url ?? false },

    contextRadiusFt: {
      ...fields.contextRadiusFt,
      role: "pose",
      url: fields.contextRadiusFt.url ?? false,
    },

    sceneView: { ...fields.sceneView, role: "pose", url: fields.sceneView.url ?? false },

    system: { ...fields.system, role: "subject", url: fields.system.url ?? false },

    level: { ...fields.level, role: "subject", url: fields.level.url ?? false },

    selected: { ...fields.selected, role: "selection", url: fields.selected.url ?? false },

    systemSearch: { ...fields.systemSearch, role: "query", url: fields.systemSearch.url ?? false },

    systemSort: { ...fields.systemSort, role: "query", url: fields.systemSort.url ?? false },

    rulingSearch: { ...fields.rulingSearch, role: "query", url: fields.rulingSearch.url ?? false },

    rulingSort: { ...fields.rulingSort, role: "query", url: fields.rulingSort.url ?? false },

    treeSearch: { ...fields.treeSearch, role: "query", url: fields.treeSearch.url ?? false },

    treeSort: { ...fields.treeSort, role: "query", url: fields.treeSort.url ?? false },

    inputSearch: { ...fields.inputSearch, role: "query", url: fields.inputSearch.url ?? false },

    inputSort: { ...fields.inputSort, role: "query", url: fields.inputSort.url ?? false },

    encoding: { ...fields.encoding, role: "pose", url: fields.encoding.url ?? false },

    layers: { ...fields.layers, role: "pose", url: fields.layers.url ?? false },

    contextStyle: { ...fields.contextStyle, role: "pose", url: fields.contextStyle.url ?? false },

    picture: { ...fields.picture, role: "pose", url: fields.picture.url ?? false },

    viewport: { ...fields.viewport, role: "pose", url: fields.viewport.url ?? false },

    issue: { ...fields.issue, role: "selection", url: fields.issue.url ?? false },

    fanPort: transient(fanPort),
    sheetPath: transient(z.string().default("")),
    readAll: transient(z.boolean().default(false)),
    allFans: transient(z.boolean().default(false)),
  },

  transition: (current, patch) => {
    const system = patch.system ? capped(patch.system) : current.system;

    const switched =
      system.join("\n") !== current.system.join("\n") &&
      !current.system.some((name) => system.includes(name));

    const selected = patch.selected ?? (switched ? "" : current.selected);

    return {
      patch: {
        ...(switched ? { selected: "", viewport: null } : {}),
        ...(switched || selected !== current.selected ? { issue: "" } : {}),
        ...patch,
        ...(patch.system ? { system } : {}),
      },
    };
  },

  cells: ductCells([
    {
      segment: "calculation",

      groupOf: (key) => [key],

      nouns: ["calculation evidence"],

      noun: "calculation evidence",

      show: (value) => (value as { kind: string }).kind,
    },

    {
      segment: "assumptions",

      groupOf: (key) => [key.split(":")[0] ?? key],

      nouns: ["assumption"],

      noun: "duct assumptions",

      show: (value) => {
        const a = value as DuctAssumption | undefined;

        return !a
          ? "take back"
          : a.kind === "verdict"
            ? a.verdict
            : a.kind === "flex-roughness"
              ? `${a.ft} ft`
              : `${a.inWg} in-wg`;
      },
    },

    {
      segment: "rules",

      groupOf: (key) => [key],

      nouns: ["rule"],

      noun: "loss rules",

      show: (value) => (value as { table: string }).table,
    },

    {
      segment: "catalogs",

      groupOf: (key) => [key],

      nouns: ["catalog link"],

      noun: "grille catalog links",

      show: (value) => (value as { table: string }).table,
    },

    {
      segment: "ruleAssignments",

      groupOf: (key) => [key],

      nouns: ["fitting family"],

      noun: "fitting families priced as a rule",

      show: (value) =>
        ruleByKey((value as { rule: string }).rule)?.family ?? (value as { rule: string }).rule,
    },

    {
      segment: "terminalDrops",

      groupOf: (key) => [key],

      nouns: ["terminal"],

      noun: "terminal drops",

      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },

    {
      segment: "componentDrops",

      groupOf: (key) => [key],

      nouns: ["component"],

      noun: "component drops",

      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },

    {
      segment: "flows",

      groupOf: (key) => [key],

      nouns: ["terminal"],

      noun: "terminal flows",

      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },

    {
      segment: "esp",

      groupOf: (key) => [key],

      nouns: ["unit"],

      noun: "unit ESPs",

      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },

    {
      segment: "equipmentFlows",

      groupOf: (key) => [key],

      nouns: ["unit"],

      noun: "unit flows",

      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },

    {
      segment: "roles",

      groupOf: (key) => [key],

      nouns: ["unit"],

      noun: "unit roles",

      show: (value) => (value as { role: string }).role,
    },
    {
      segment: "parameters",

      groupOf: (key) => [key],

      nouns: ["slot"],

      noun: "parameter slots",

      show: (value) => String(value),
    },
    {
      // Keyed JSON.stringify([family, type]): the family groups its types.
      segment: "kinds",
      groupOf: (key) => JSON.parse(key) as [string, string],
      nouns: ["family", "type"],
      noun: "unit kinds",
      show: (value) => (value as { kind: string }).kind,
    },
    {
      segment: null,
      key: "criteria",
      groupOf: () => ["design criteria"],
      noun: "design criteria",
      // "velocity limit supply 850, split policy even": only the sides the project layer holds.
      show: (value) =>
        Object.entries(value as Record<string, unknown>)
          .map(([key, v]) => {
            const word = CRITERION_WORDS[key as keyof typeof CRITERION_WORDS] ?? key;
            return v !== null && typeof v === "object"
              ? `${word} ${Object.entries(v)
                  .filter(([, n]) => n !== undefined)
                  .map(([side, n]) => `${side} ${n}`)
                  .join(" ")}`
              : `${word} ${v}`;
          })
          .join(", "),
    },
  ]),

  readings: {
    roster: { kind: "use", source: "ducts.roster", retire: "target" },

    ducts: {
      kind: "use",
      source: "ducts.networks",
      deps: ["roster"],
      args: (p) => ({ system: p.system, readAll: p.readAll }),
      retire: "page",
    },

    tables: { kind: "use", source: "ducts.tables", retire: "target" },

    catalogs: { kind: "use", source: "ducts.catalogs", retire: "never" },

    pricing: {
      kind: "worker",
      source: "ducts.pricing",
      deps: ["ducts", "tables", "catalogs"],
      retire: "target",
    },

    fans: { kind: "use", source: "ducts.fans", retire: "target" },

    sheet: {
      kind: "use",
      source: "ducts.sheet",
      deps: ["fans"],
      args: (p) => ({ fanPort: p.fanPort, path: p.sheetPath, all: p.allFans }),
      retire: "page",
    },

    sheetSnapshot: {
      kind: "use",
      source: "ducts.sheet-snapshot",
      deps: ["sheet"],
      retire: "target",
    },
  },

  verbs: {
    refresh: commandVerb(
      "ducts.refresh",
      { label: "Refresh", input: none, review: "none", effect: "query" },
      { intent: () => ({}) },
    ),

    price: commandVerb(
      "ducts.apply-losses",
      {
        label: "Price",
        input: priceInput,
        review: "shown",
        says: "Review the planned writes, then write them to Revit",
        effect: "command",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: requestReady,

        prepare: (scope, input) =>
          prepareCommand(scope, "ducts.preview-losses", input.request!, NATIVE_APPLY_WAIT_S),

        intent: (_, input) => input.request!,
      },
    ),

    heal: commandVerb(
      "ducts.apply-heal",
      { label: "Heal", input: healInput, review: "shown", effect: "command" },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: requestReady,

        prepare: (scope, input) =>
          prepareCommand(scope, "ducts.preview-heal", input.request!, NATIVE_APPLY_WAIT_S),

        intent: (_, input) => input.request!,
      },
    ),

    "assign-fan": commandVerb(
      "ducts.apply-assign-fan",
      { label: "Assign fan", input: assignInput, review: "shown", effect: "command" },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: requestReady,

        prepare: (scope, input) =>
          prepareCommand(scope, "ducts.preview-assign-fan", input.request!, NATIVE_APPLY_WAIT_S),

        intent: (_, input) => input.request!,
      },
    ),

    "sheet-inputs": workVerb(
      {
        label: "Edit sheet inputs",
        input: z.strictObject({
          edits: ductsSheetEditsSchema,
          basis: z.string().nullable(),
          expectedRevision: z.number().int(),
        }),
      },
      {
        ready: (scope, input) =>
          scope.snapshot.work?.handle.revision !== input.expectedRevision
            ? "Work changed; edit the current inputs"
            : !scope.readings.sheet?.current ||
                !input.basis ||
                (
                  scope.readings.sheet.value as
                    | { open?: { overview: { basis: string } } }
                    | undefined
                )?.open?.overview.basis !== input.basis
              ? "Read the current sheet before editing its inputs"
              : null,
        patches: (scope, input) =>
          editPatches(input.edits, scope.snapshot.work!.doc as DuctsRouteDocument),
      },
    ),
    edit: workVerb(
      {
        label: "Edit",
        input: z.strictObject({
          patches: z.array(routeStatePatchSchema),
          expectedRevision: z.number().int(),
        }),
      },
      {
        ready: (scope, input) =>
          scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current cell",
        patches: (_, input) => input.patches,
      },
    ),
  },

  panes: {
    "e-systems": {
      label: "Systems",
      purpose: "Choose a system to inspect",
      draws: ["roster", "ducts", "pricing"],
      verbs: [],
    },

    "e-sidebar": {
      label: "System tree",
      purpose: "Inspect the opened systems and their runs",
      draws: ["pricing"],
      verbs: [],
    },

    "e-inputs": {
      label: "Inputs",
      purpose: "Edit flow, ESP, role and drop",
      draws: ["pricing"],
      verbs: Object.assign(
        (row: never) =>
          (row as { kind?: string } | undefined)?.kind === "assign-fan" ? ["assign-fan"] : [],
        { ids: ["assign-fan"] },
      ),
    },

    "e-rules-all": {
      label: "All-systems rules",
      purpose: "Price every read fitting type",
      draws: ["pricing"],
      verbs: [],
    },

    "e-rules": {
      label: "This system's rules",
      purpose: "Review fitting rules for the opened systems",
      draws: ["pricing"],
      verbs: [],
    },

    "e-picture": {
      label: "Picture",
      purpose: "Inspect the model or schematic",
      draws: ["pricing"],
      verbs: [],
    },

    "e-inbox": {
      label: "Rulings",
      purpose: "Review assumptions and planned writes",
      draws: ["pricing"],
      verbs: Object.assign(
        (row: never) => {
          const kind = (row as { kind?: string } | undefined)?.kind;
          return kind === "price" || kind === "heal" || kind === "assign-fan" ? [kind] : [];
        },
        { ids: ["price", "heal", "assign-fan"] },
      ),
    },

    "sheet-roster": {
      label: "Fans",
      purpose: "Open a fan port to read its sheet",
      draws: ["fans", "sheet"],
      verbs: [],
    },

    "sheet-inputs": {
      label: "Inputs",
      purpose: "Edit firm, project, fan and element inputs",
      draws: ["sheet"],
      verbs: [],
    },

    "sheet-picture": {
      label: "Picture",
      purpose: "Inspect the fan's walk and blockers",
      draws: ["sheet", "sheetSnapshot"],
      verbs: [],
    },

    "sheet-ledger": {
      label: "Ledger",
      purpose: "Required ESP and blockers by consent tier",
      draws: ["sheet"],
      verbs: [],
    },
  },

  layout: split(
    "stages",
    { axis: "h", sized: "start", size: 420 },

    gate(
      "network",
      split(
        "sidebar",
        { axis: "h", sized: "start", size: 420 },

        split(
          "stack",
          { axis: "v", sized: "end", size: 176 },

          split(
            "scope-upper",
            { axis: "v", sized: "start", size: 240 },
            pane("e-systems"),
            gate(
              "system",
              split(
                "inputs",
                { axis: "v", sized: "end", size: 220 },
                pane("e-sidebar"),
                pane("e-inputs"),
              ),
            ),
          ),

          split(
            "scope-lower",
            { axis: "v", sized: "start", size: 176 },
            pane("e-rules-all"),
            gate("system", pane("e-rules")),
          ),
        ),

        split(
          "drawing",
          { axis: "h", sized: "end", size: 340 },
          pane("e-picture"),
          pane("e-inbox"),
        ),
      ),
    ),

    gate(
      "sheet",
      split(
        "sheet-layout",
        { axis: "h", sized: "start", size: 420 },

        split(
          "sheet-side",
          { axis: "v", sized: "end", size: 360 },
          pane("sheet-roster"),
          pane("sheet-inputs"),
        ),

        split(
          "sheet-main",
          { axis: "v", sized: "start", size: 360 },
          pane("sheet-picture"),
          pane("sheet-ledger"),
        ),
      ),
    ),
  ),

  predicates: {
    network: (p) => p.stage === "network",
    sheet: (p) => p.stage === "sheet",
    system: (p) => p.system.length > 0,
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
      verbs: ["refresh", "price", "heal", "assign-fan"],
    },

    sheet: {
      word: "Pricing fans",
      panes: ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"],
      verbs: ["refresh"],
    },
  },

  stageOrder: ["network", "sheet"],
  pick: false,
};
