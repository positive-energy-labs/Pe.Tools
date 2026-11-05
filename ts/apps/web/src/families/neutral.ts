import type { HostRouteModule } from "../../../../packages/agent-contracts/src/host-route-admission.ts";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
import { z } from "zod";
import {
  actionReceiptListDecoder,
  commands,
  routeStatePatchSchema,
  canonicalRouteInput,
  appliedScopeSchema,
  showFamilyCell,
  familiesRouteState,
  familiesObservationSchema,
  familyCellKey,
  familyCellValueSchema,
  familyCellAddress,
  cellPatches,
  applyPatches,
  familyCellStateSchema,
  workKeySchema,
} from "@pe/agent-contracts";
import type {
  BodyBindings,
  BodyContext,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { familiesReads } from "../../../../packages/mcps/src/shared/families-client.ts";

// Host admission consumes this module without loading the browser pane or sources.
const scopeSchema = z.custom<
  import("../../../../packages/agent-contracts/src/route-kernel-page.ts").IdentityId<"local">
>((value) => value === '["families","draft"]');
export const familiesScopeId = scopeSchema.parse('["families","draft"]');
const empty = { page: [], work: [], readings: [] } as const;
const retained = { evidence: "scope", resource: "scope" } as const;
const workKeys = ["scope", "cells", "patch", "excluded", "takenAt"] as const;
export const familiesData = {
  version: 1,
  capabilities: ["work", "native-write", "geometry"],
  key: "families",
  address: "/families",
  name: "Families",
  directory: {
    group: "Build / audit families",
    summary: "Audit and reconcile loaded family parameters",
    label: "Family Foundry",
    icon: "Table2",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["audit", "parameters"],
    runtimeNeed: "Revit for model actions",
    listed: true,
    satellites: [],
    resume: "document",
  },
  identities: { scope: { kind: "local", codec: "local" } },
  fields: {
    scope: {
      role: "subject",
      schema: "subject",
      codec: "json",
      initial: familiesScopeId,
      cardinality: "one",
      identity: "scope",
      picker: { reading: "scopes", options: "pickScope" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["scope"] },
    readId: {
      role: "pose",
      schema: "text",
      codec: "json",
      initial: "",
      url: false,
      share: false,
      agent: "none",
    },
    focus: {
      role: "pose",
      schema: "text",
      codec: "json",
      initial: "",
      url: false,
      share: false,
      agent: "set",
    },
  },
  subject: {
    field: "scope",
    noun: "family draft scope",
    roster: "scopes",
    detail: "matrix",
    pane: "main",
  },
  salvage: "salvage",
  work: { route: "families", schema: "work", version: 1, migrations: {} },
  readings: {
    receipts: {
      kind: "use",
      entry: "families.receipts",
      args: "receiptArgs",
      deps: { page: [], work: [], readings: ["matrix"] },
      demand: "visible",
      retain: retained,
      refresh: "dependencies",
    },
    catalog: {
      kind: "use",
      entry: "revit.catalog.loaded-families",
      args: "catalogArgs",
      deps: empty,
      demand: "visible",
      retain: retained,
      refresh: "explicit",
    },
    scopes: {
      kind: "derive",
      output: "scopes",
      derive: "scopes",
      deps: empty,
      demand: "visible",
      retain: retained,
      refresh: "dependencies",
    },
    matrix: {
      kind: "use",
      entry: "families.read",
      args: "matrixArgs",
      deps: empty,
      demand: "explicit",
      retain: retained,
      refresh: "explicit",
    },
    preview: {
      kind: "use",
      entry: "families.apply.preview",
      args: "previewArgs",
      deps: empty,
      demand: "explicit",
      retain: retained,
      refresh: "explicit",
    },
  },
  verbs: {
    writeCells: {
      kind: "work",
      input: "cellPatches",
      label: "Review family cell",
      review: "none",
      patches: "writeCells",
      describe: "describeCells",
      ready: "cellsReady",
      deps: { page: [], work: workKeys, readings: ["matrix"] },
      captures: [],
    },
    pick: {
      kind: "work",
      input: "filter",
      label: "Choose families",
      review: "none",
      patches: "pick",
      deps: empty,
      captures: [],
    },
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit family value",
      review: "none",
      patches: "edit",
      describe: "describeEdit",
      ready: "editReady",
      deps: { page: [], work: workKeys, readings: ["matrix"] },
      captures: [],
    },
    revert: {
      kind: "work",
      input: "key",
      label: "Revert family value",
      review: "none",
      patches: "revert",
      deps: { page: [], work: ["cells"], readings: [] },
      captures: [],
    },
    apply: {
      kind: "command",
      entry: "families.apply",
      intent: "apply",
      input: "none",
      label: "Apply families",
      review: "shown",
      ready: "applyReady",
      present: "present",
      deps: { page: [], work: workKeys, readings: ["matrix"] },
      captures: [],
    },
    read: {
      kind: "query",
      entry: "families.read",
      reading: "matrix",
      args: "read",
      input: "read",
      label: "Read families",
      review: "none",
      cancellation: "scope",
      deps: { page: [], work: ["scope"], readings: [] },
      captures: [],
    },
    stop: {
      kind: "command",
      entry: "families.cancel-read",
      intent: "stop",
      input: "stop",
      label: "Stop family read",
      review: "none",
      deps: empty,
      captures: [],
    },
  },
  panes: {
    main: {
      label: "Families",
      purpose: "Audit family values",
      draws: ["matrix", "catalog", "receipts"],
      verbs: ["writeCells", "pick", "read", "stop", "edit", "revert", "apply"],
      body: "main",
    },
  },
  layout: { kind: "pane", id: "main" },
  stages: { audit: { word: "Auditing", panes: ["main"], verbs: ["read", "stop", "apply"] } },
  stageOrder: ["audit"],
  predicates: {},
  cells: {
    parameters: {
      segment: "cells",
      value: "cell",
      key: "key",
      groupOf: "group",
      label: "label",
      show: "show",
      focus: "focus",
      deps: empty,
    },
  },
  workFields: {
    cells: { label: "family parameters", internal: false },
    takenAt: { label: "capture time", internal: true },
  },
  seeds: { audit: { title: "Family parameters", load: "seed" } },
  needs: "project",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
export const familiesSchemas = {
  subject: scopeSchema.nullable(),
  text: z.string(),
  observation: familiesObservationSchema,
  cell: familyCellStateSchema,
  filter: appliedScopeSchema,
  scopes: z.array(z.object({ id: z.string(), label: z.string() })),
  work: familiesRouteState.schema,
  edit: z.object({
    address: z.object({ familyName: z.string(), typeName: z.string(), parameter: z.string() }),
    value: familyCellValueSchema,
    current: z.string(),
  }),
  cellPatches: z
    .array(routeStatePatchSchema)
    .refine((patches) => patches.every((p) => p.path[0] === "cells" && p.path.length > 1)),
  key: z.string(),
  none: z.strictObject({}),
  read: familiesReads["families.read"].input,
  stop: familiesReads["families.cancel-read"].input,
};
const readAxes = {
  subject: "Elements",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const familiesEntries = {
  "families.receipts": {
    input: workKeySchema.nullable(),
    output: actionReceiptListDecoder(),
    axes: readAxes,
  },
  "revit.catalog.loaded-families": {
    input: z.object({ filter: z.object({}), budget: z.object({ maxEntries: z.number() }) }),
    output: z.object({
      families: z.array(
        z.object({
          familyId: z.number(),
          familyName: z.string(),
          categoryName: z.string().nullable().optional(),
          placedInstanceCount: z.number().nullable().optional(),
        }),
      ),
    }),
    axes: readAxes,
  },
  "families.read": {
    input: familiesReads["families.read"].input.extend({ work: workKeySchema }),
    output: familiesObservationSchema,
    axes: readAxes,
  },
  "families.cancel-read": {
    input: familiesReads["families.cancel-read"].input,
    output: z.object({ cancelled: z.literal(true) }),
    axes: { ...readAxes, effect: "SessionWrite" as const },
  },
  "families.apply": {
    input: commands["families.apply"].input,
    output: commands["families.apply"].result,
    axes: { ...commandCatalogAxes["families.apply"], effect: "ModelWrite" as const },
  },
  "families.apply.preview": {
    input: commands["families.apply.preview"].input,
    output: commands["families.apply.preview"].result,
    axes: commandCatalogAxes["families.apply.preview"],
  },
};
const source = { module: "families/neutral.ts", export: "familiesNeutralBodies" };
export const familiesNeutralBodies: Omit<
  BodyBindings<typeof familiesData, typeof familiesSchemas, typeof familiesEntries>,
  "main" | "seed"
> = {
  receiptArgs: {
    slot: "readings.receipts.args",
    kind: "args",
    source,
    run: (ctx) => ctx.readings.matrix.value?.work ?? null,
  },
  describeCells: {
    slot: "verbs.writeCells.describe",
    kind: "describe",
    source,
    run: (patches) => ({
      label: patches
        .map((p) => {
          const a = familyCellAddress(String(p.path[1]));
          return `${a.parameter} / ${a.typeName}`;
        })
        .join(", "),
    }),
  },
  writeCells: {
    slot: "verbs.writeCells.patches",
    kind: "work",
    source,
    run: (ctx, patches) => {
      const result = applyPatches(
        familiesRouteState,
        { version: 1, revision: 0, doc: familiesRouteState.schema.parse(ctx.work) },
        "human",
        patches,
        0,
      );
      if (!result.ok) throw Error("Invalid family cell change");
      return [...new Set(patches.map((p) => String(p.path[1])))].map((key) => {
        const value = result.envelope.doc.cells[key];
        return value
          ? { path: ["cells", key] as const, value }
          : { path: ["cells", key] as const, op: "delete" as const };
      });
    },
  },
  catalogArgs: {
    slot: "readings.catalog.args",
    kind: "args",
    source,
    run: () => ({ filter: {}, budget: { maxEntries: 5000 } }),
  },
  pick: {
    slot: "verbs.pick.patches",
    kind: "work",
    source,
    run: (_, input) => [{ path: ["scope"], value: { edit: { value: input } } }],
  },
  group: {
    slot: "cells.parameters.groupOf",
    kind: "group",
    source,
    run: (key) => {
      const a = familyCellAddress(key);
      return [a.parameter, a.familyName, a.typeName];
    },
  },
  label: { slot: "cells.parameters.label", kind: "label", source, run: (part) => part },
  show: {
    slot: "cells.parameters.show",
    kind: "show",
    source,
    run: (cell) => (cell.edit ? showFamilyCell(cell.edit!.value) : ""),
  },
  focus: { slot: "cells.parameters.focus", kind: "focus", source, run: (key) => ({ focus: key }) },
  salvage: {
    slot: "salvage",
    kind: "salvage",
    source,
    run: (raw, ctx) => {
      const got = z
        .object({
          familyNames: z.array(z.string()),
          familyIds: z.array(z.number()),
          scope: appliedScopeSchema.optional(),
        })
        .parse(raw);
      if (!ctx.work || !ctx.readings.catalog.current)
        return { ok: false, reason: "Read the current family catalog before recovery" };
      const work = familiesRouteState.schema.parse(ctx.work);
      const names = new Set([
        ...got.familyNames,
        ...ctx.readings.catalog.value.families
          .filter((f) => got.familyIds.includes(f.familyId))
          .map((f) => f.familyName),
      ]);
      return {
        ok: true,
        value: [
          ...(got.scope && !work.scope.edit
            ? [{ path: ["scope"] as const, value: { ...work.scope, edit: { value: got.scope } } }]
            : []),
          ...[...names]
            .filter((name) => !Object.hasOwn(work.excluded, name))
            .map((name) => ({
              path: ["excluded", name] as const,
              value: { by: "human" as const },
            })),
        ],
      };
    },
  },
  present: {
    slot: "verbs.apply.present",
    kind: "present",
    source,
    run: (_, evidence) => ({
      sentence: "Review family parameter changes",
      rows: Object.entries(evidence.work.cells).flatMap(([key, cell]) => {
        if (!cell.edit) return [];
        const a = familyCellAddress(key);
        return [
          `${a.familyName} / ${a.typeName} / ${a.parameter}: observed value to ${showFamilyCell(cell.edit.value)}`,
        ];
      }),
    }),
  },
  scopes: {
    slot: "readings.scopes.derive",
    kind: "derive",
    source,
    run: () => [{ id: familiesScopeId, label: "Family draft scope" }],
  },
  pickScope: {
    slot: "fields.scope.picker.options",
    kind: "picker",
    source,
    run: () => [{ id: familiesScopeId, label: "Family draft scope" }],
  },
  matrixArgs: {
    slot: "readings.matrix.args",
    kind: "args",
    source,
    run: () => {
      throw Error("Use Read families with an accepted Work basis");
    },
  },
  previewArgs: {
    slot: "readings.preview.args",
    kind: "args",
    source,
    run: () => {
      throw Error("Prepare Apply families from accepted Work");
    },
  },
  read: {
    slot: "verbs.read.args",
    kind: "args",
    source,
    run: (ctx, input) => {
      const work = ctx.workBasis?.token.scope.identity.work;
      if (!work || ctx.workBasis?.workRevision == null) throw Error("Accepted Work unavailable");
      return { ...input, work, expectedRevision: ctx.workBasis.workRevision };
    },
  },
  stop: { slot: "verbs.stop.intent", kind: "intent", source, run: (_, input) => input },
  cellsReady: {
    slot: "verbs.writeCells.ready",
    kind: "ready",
    source,
    run: (
      ctx: BodyContext<
        typeof familiesData,
        typeof familiesSchemas,
        typeof familiesEntries,
        typeof familiesData.verbs.edit
      >,
    ) =>
      ctx.readings.matrix.current &&
      ctx.readings.matrix.value.capturedAt === ctx.work.takenAt &&
      canonicalRouteInput(ctx.readings.matrix.value.filter) ===
        canonicalRouteInput(ctx.work.scope.edit?.value)
        ? true
        : "Read these families before editing",
  },
  editReady: {
    slot: "verbs.edit.ready",
    kind: "ready",
    source,
    run: (
      ctx: BodyContext<
        typeof familiesData,
        typeof familiesSchemas,
        typeof familiesEntries,
        typeof familiesData.verbs.edit
      >,
    ) =>
      ctx.readings.matrix.current &&
      ctx.readings.matrix.value.capturedAt === ctx.work.takenAt &&
      canonicalRouteInput(ctx.readings.matrix.value.filter) ===
        canonicalRouteInput(ctx.work.scope.edit?.value)
        ? true
        : "Read these families before editing",
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (ctx, input) => {
      const key = familyCellKey(input.address);
      const patches = cellPatches(["cells"], key, ctx.work.cells[key] ?? {}, {
        kind: "set",
        rung: { value: input.value },
        baseline: { value: { value: input.current, storageType: input.value.storageType } },
      });
      const result = applyPatches(
        familiesRouteState,
        { version: 1, revision: 0, doc: familiesRouteState.schema.parse(ctx.work) },
        "human",
        patches,
        0,
      );
      if (!result.ok) throw Error("Invalid family edit");
      const cell = result.envelope.doc.cells[key];
      return cell
        ? [{ path: ["cells", key], value: cell }]
        : [{ path: ["cells", key], op: "delete" }];
    },
  },
  describeEdit: {
    slot: "verbs.edit.describe",
    kind: "describe",
    source,
    run: (input) => ({
      label: `${input.address.familyName} / ${input.address.typeName} / ${input.address.parameter} to ${input.value.value}`,
    }),
  },
  revert: {
    slot: "verbs.revert.patches",
    kind: "work",
    source,
    run: (_, key) => {
      familyCellAddress(key);
      return [{ path: ["cells", key], op: "delete" }];
    },
  },
  apply: { slot: "verbs.apply.intent", kind: "intent", source, run: () => ({}) },
  applyReady: {
    slot: "verbs.apply.ready",
    kind: "ready",
    source,
    run: (ctx) => {
      if (
        !ctx.readings.matrix.current ||
        ctx.readings.matrix.value.capturedAt !== ctx.work.takenAt ||
        canonicalRouteInput(ctx.readings.matrix.value.filter) !==
          canonicalRouteInput(ctx.work.scope.edit?.value)
      )
        return "Read these families before planning";
      if (ctx.work.patch.edit && Object.values(ctx.work.cells).some((c) => c.edit))
        return "Stage either a patch or per-type cells";
      return true;
    },
  },
};
// Host recovery extracts canonical bytes; web salvage derives review patches.
export const familiesHostModule: HostRouteModule = {
  data: familiesData,
  schemas: familiesSchemas,
  bodies: {
    salvage: {
      slot: "salvage",
      kind: "recovery" as const,
      source,
      run: familiesRouteState.salvage,
    },
  },
  workState: familiesRouteState,
};
