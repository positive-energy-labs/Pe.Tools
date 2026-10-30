import { familiesQueries } from "../../../../packages/mcps/src/shared/query-client";
import { z } from "zod";
import {
  appliedScopeSchema,
  familiesRouteState,
  familyCellKey,
  familyCellValueSchema,
  familyPlanResultSchema,
  gate,
  pane,
  routeAddress,
  routeStatePatchSchema,
  split,
  transitionPatches,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type PodDraftSource,
  type RouteGraph,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { familiesAddress } from "../../../../packages/agent-contracts/src/routes/families";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import {
  familiesReads,
  familiesObservationSchema,
} from "../../../../packages/mcps/src/shared/families-client";
import { commandVerb, prepareCommand, queryVerb, workVerb } from "#/shell/verbs";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { filterWords } from "./filters";
import { familiesGroupOf } from "./staged";

export const FAMILIES_SPEC_SCHEMAS = [
  "/schemas/settings/FamilyFoundry/patches.json",
  "/schemas/settings/FamilyFoundry/models.json",
] as const;

const fields = { ...threadListFields, ...familiesAddress.fields };
const draft = z
  .object({
    placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("PlacedOnly"),
    categories: z.array(z.string()).default([]),
    families: z.array(z.string()).nullable().default(null),
  })
  .nullable()
  .default(null);
export const familiesPageSchema = routeAddress("families").schema.extend({ draft });
export type FamiliesPage = z.output<typeof familiesPageSchema>;
const source = z.object({ pod: z.string(), path: z.string(), sha256: z.string() }).optional();
const refusal = z.string().nullable().default(null);
const guarded = <S extends z.ZodType>(request: S) => z.strictObject({ request, refusal });

export const familiesGraph: RouteGraph<FamiliesPage, FamiliesRouteDocument> = {
  seeds: {
    audit: {
      title: "Loaded family matrix",
      load: () => import("./graph-seeds").then((m) => m.familiesSeeds["audit"]!),
    },
    apply: {
      title: "Plan family changes",
      load: () => import("./graph-seeds").then((m) => m.familiesSeeds["apply"]!),
    },
  },
  key: familiesRouteState.route,
  address: "families",
  name: "Families",
  needs: "project",
  work: familiesRouteState.schema,
  fields: {
    threadSearch: { ...fields.threadSearch, role: "query" },
    threadSort: { ...fields.threadSort, role: "query" },
    stage: { ...fields.stage, role: "stage" },
    pod: { ...fields.pod, role: "subject" },
    path: { ...fields.path, role: "subject" },
    pane: { ...fields.pane, role: "pose", url: false },
    query: { ...fields.query, role: "query" },
    sort: { ...fields.sort, role: "query" },
    hidden: { ...fields.hidden, role: "pose" },
    lines: { ...fields.lines, role: "selection" },
    past: { ...fields.past, role: "selection" },
    draft: {
      ...field(draft, {}, { encode: JSON.stringify, decode: (text) => JSON.parse(text) }),
      role: "draft",
      url: false,
    },
  },
  salvage: (raw, work, scope) => {
    const got = z
      .object({
        familyNames: z.array(z.string()).default([]),
        familyIds: z.array(z.number().int()).default([]),
        scope: appliedScopeSchema.optional(),
      })
      .parse(raw);
    const catalog = z
      .object({
        current: z.literal(true),
        value: z.array(z.object({ familyId: z.number().int(), familyName: z.string() })),
      })
      .safeParse(scope.readings.catalog);
    const names = new Set([
      ...got.familyNames,
      ...(catalog.success
        ? catalog.data.value
            .filter((family) => got.familyIds.includes(family.familyId))
            .map((family) => family.familyName)
        : []),
    ]);
    return [
      ...(got.scope && !work?.scope.edit
        ? [{ path: ["scope", "edit"], value: { value: got.scope } }]
        : []),
      ...[...names]
        .filter((name) => !Object.hasOwn(work?.excluded ?? {}, name))
        .map((name) => ({
          path: ["excluded", name],
          value: { by: "human" },
        })),
    ];
  },
  cells: [
    // The audited scope is a root cell Pea proposes (F-J1-10): its own group, beside the cells.
    {
      segment: null,
      key: "scope",
      groupOf: () => ["scope"],
      show: (value) => filterWords(value as AppliedFilter),
      commit: "plan",
    },
    {
      segment: null,
      key: "patch",
      groupOf: () => ["native FF patch"],
      // Exact bytes are reviewed in Families.
      show: (value) => {
        const source = value as PodDraftSource;
        try {
          const patch = JSON.parse(source.content);
          const names = patch?.select?.names;
          const parameters = patch?.patch?.parameters;
          if (
            Array.isArray(names) &&
            parameters &&
            typeof parameters === "object" &&
            !Array.isArray(parameters)
          )
            return `${Object.keys(parameters).join(", ")} · ${names.length} named families`;
        } catch {
          // Invalid source is still reviewable; the route owns validation.
        }
        return source.path;
      },
      commit: "plan",
    },
    {
      segment: "cells",
      groupOf: familiesGroupOf,
      nouns: ["parameter", "family"],
      show: (value) =>
        String(
          typeof value === "object" && value !== null && "value" in value ? value.value : value,
        ),
      commit: "plan",
    },
  ],
  readings: {
    matrix: {
      kind: "use",
      source: "families.matrix",
      retire: "page",
      args: (page) => [page.stage, page.draft],
    },
    categories: { kind: "use", source: "families.categories", retire: "target" },
    catalog: { kind: "use", source: "families.catalog", retire: "target" },
    receipts: { kind: "use", source: "families.receipts", retire: "target" },
    archive: {
      kind: "use",
      source: "families.archive",
      retire: "page",
      args: (page) => page.stage,
    },
    saved: {
      kind: "use",
      source: "families.saved",
      retire: "page",
      deps: ["archive"],
      args: (page) => [page.stage, page.past],
    },
    pods: { kind: "use", source: "families.pods", retire: "never" },
  },
  verbs: {
    edit: workVerb(
      {
        label: "Edit family cells",
        input: z.strictObject({
          patches: z.array(routeStatePatchSchema),
          expectedRevision: z.number().int(),
          refusal,
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current family cells"),
        patches: (_, input) => input.patches,
      },
    ),
    propose: workVerb(
      {
        label: "Edit family value",
        input: z.strictObject({
          address: z.object({
            familyName: z.string(),
            typeName: z.string(),
            parameter: z.string(),
          }),
          value: familyCellValueSchema,
          current: z.string(),
          refusal,
        }),
      },
      {
        ready: (_, input) => input.refusal,
        patches: (scope, input) => {
          const key = familyCellKey(input.address);
          const doc = scope.snapshot.work!.doc as FamiliesRouteDocument;
          return transitionPatches(["cells"], key, doc.cells[key] ?? {}, {
            kind: "set",
            rung: { value: input.value },
            baseline: { value: { value: input.current, storageType: input.value.storageType } },
          });
        },
      },
    ),
    exclude: workVerb(
      { label: "Hold family back", input: z.strictObject({ name: z.string().min(1), refusal }) },
      {
        ready: (_, input) => input.refusal,
        patches: (scope, input) => [
          {
            path: ["excluded", input.name],
            ...(Object.hasOwn(
              (scope.snapshot.work!.doc as FamiliesRouteDocument).excluded,
              input.name,
            )
              ? {}
              : { value: { by: "human" } }),
          },
        ],
      },
    ),
    read: queryVerb(
      familiesQueries["families.read"],
      {
        label: "Read families",
        review: "none",
        chord: "R",
        input: guarded(familiesReads["families.read"].input),
        says: "Read the drafted scope from this exact document; picker changes do not read Revit",
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => input.request,
        cancel: {
          key: familiesQueries["families.cancel-read"],
          input: (request) => ({ readId: request.readId }),
        },
        expectedRevision: (scope, value) =>
          familiesObservationSchema.parse(value).envelope?.revision ??
          scope.snapshot.work!.handle.revision,
        patches: (_, value) => {
          const reading = familiesObservationSchema.parse(value);
          return reading.progress && reading.progress.state !== "complete"
            ? []
            : [{ path: ["scope", "edit"], value: { value: reading.filter } }];
        },
      },
    ),
    "cancel-read": queryVerb(
      familiesQueries["families.cancel-read"],
      {
        label: "Stop family read",
        review: "none",
        input: guarded(familiesReads["families.cancel-read"].input),
      },
      { ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
    apply: commandVerb(
      "families.apply",
      {
        label: "Apply families",
        review: "shown",
        chord: "Mod+Enter",
        input: z.strictObject({ source, refusal }),
        says: "Preview these exact Work bytes and held families, then apply the sealed plan",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: async (scope, input) => {
          const preview = await prepareCommand(
            scope,
            "families.plan",
            input.source ? { source: input.source } : {},
            NATIVE_APPLY_WAIT_S,
          );
          return { ...preview, plan: familyPlanResultSchema.parse(preview.response) };
        },
        intent: (_scope, _input, _answers, ticket) => ({
          plan: familyPlanResultSchema.parse((ticket?.evidence as { plan?: unknown })?.plan).id,
          include: "all",
        }),
      },
    ),
    capture: commandVerb(
      "families.capture",
      {
        label: "Capture families",
        review: "none",
        input: z.strictObject({ pod: z.string(), familyIds: z.array(z.number().int()), refusal }),
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ pod: input.pod, familyIds: input.familyIds }),
      },
    ),
    "save-draft": commandVerb(
      "families.save-draft",
      {
        label: "Save draft to pod",
        review: "none",
        input: z.strictObject({ pod: z.string(), refusal }),
      },
      { ready: (_, input) => input.refusal, intent: (_, input) => ({ pod: input.pod }) },
    ),
  },
  panes: {
    scope: {
      label: "Family scope",
      purpose: "Draft the next read without reading Revit",
      draws: ["categories", "catalog"],
      verbs: ["read", "cancel-read"],
    },
    matrix: {
      label: "Family matrix",
      purpose: "Inspect and edit parameters across family types",
      draws: ["matrix", "saved", "archive", "receipts"],
      verbs: [],
    },
    work: {
      label: "Family Work",
      purpose: "Review scope, patches, keyed cells and receipts",
      draws: ["matrix", "receipts"],
      verbs: Object.assign(
        (row: unknown) =>
          typeof (row as { name?: unknown } | null)?.name === "string" ? ["exclude"] : [],
        { ids: ["exclude"] },
      ),
    },
    spec: {
      label: "Family spec",
      purpose: "Choose an exact saved Family Foundry source",
      draws: ["pods"],
      verbs: [],
    },
    history: {
      label: "Past family reads",
      purpose: "Choose an immutable saved family read",
      draws: ["archive"],
      verbs: [],
    },
  },
  layout: split(
    "families-body",
    { axis: "h", sized: "start", size: 240 },
    split(
      "families-scope",
      { axis: "v", sized: "start", size: 240 },
      gate("editing", pane("scope")),
      gate("history", pane("history")),
    ),
    split(
      "families-main",
      { axis: "v", sized: "end", size: 180 },
      split(
        "families-spec",
        { axis: "h", sized: "end", size: 420 },
        pane("matrix"),
        gate("apply", pane("spec")),
      ),
      gate("editing", pane("work")),
    ),
  ),
  predicates: { editing: (page) => page.stage !== "history" },
  stages: {
    audit: { word: "Auditing", panes: ["scope", "matrix", "work"], verbs: ["capture"] },
    apply: {
      word: "Applying",
      panes: ["scope", "matrix", "work", "spec"],
      verbs: ["apply", "save-draft"],
    },
    history: { word: "History", panes: ["history", "matrix"], verbs: [] },
  },
  stageOrder: ["audit", "apply", "history"],
};
