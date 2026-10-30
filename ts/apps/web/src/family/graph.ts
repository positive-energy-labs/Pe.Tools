import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";
import { z } from "zod";
import {
  commands,
  familyDraftRouteState,
  familyPlanResultSchema,
  familyReads,
  gate,
  pane,
  podMemberSourceSchema,
  routeAddress,
  routeStatePatchSchema,
  settingsFieldSegments,
  split,
  type FamilyDraft,
  type RouteGraph,
} from "@pe/agent-contracts";
import { familyAddress } from "../../../../packages/agent-contracts/src/routes/family";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { commandVerb, prepareCommand, queryVerb, workVerb, pageVerb } from "#/shell/verbs";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";

export const FAMILY_MODEL_SCHEMA = "/schemas/settings/FamilyFoundry/models.json";
export const familyPageSchema = routeAddress("family").schema;
export type FamilyPage = z.output<typeof familyPageSchema>;
const fields = { ...threadListFields, ...familyAddress.fields };
const refusal = z.string().nullable().default(null);
const familyCellParameter = (key: string) => {
  if (!key.startsWith("/")) return null;
  const [root, name] = settingsFieldSegments(key);
  return root === "parameters" && name ? name : null;
};

export const familyGraph: RouteGraph<FamilyPage, FamilyDraft> = {
  key: familyDraftRouteState.route,
  address: "family",
  name: "Family",
  seeds: {
    box: { title: "box", load: () => import("./graph-seeds").then((m) => m.familySeeds["box"]!) },
    grd: { title: "grd", load: () => import("./graph-seeds").then((m) => m.familySeeds["grd"]!) },
    bath: {
      title: "bath",
      load: () => import("./graph-seeds").then((m) => m.familySeeds["bath"]!),
    },
    refline: {
      title: "refline",
      load: () => import("./graph-seeds").then((m) => m.familySeeds["refline"]!),
    },
  },
  needs: "family",
  work: familyDraftRouteState.schema,
  // A saved member is input to the document-owned draft, not a different Work.
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
    overlay: { ...fields.overlay, role: "pose" },
    drill: { ...fields.drill, role: "selection" },
    inspector: { ...fields.inspector, role: "selection" },
    doc: { ...fields.doc, role: "pose" },
  },
  cells: [
    {
      segment: "cells",
      groupOf: (key) => [familyCellParameter(key) ?? key],
      nouns: ["parameter"],
      focus: (key): Record<string, string> => {
        const name = familyCellParameter(key);
        return name ? { inspector: `param:${name}` } : {};
      },
    },
  ],
  readings: {
    profile: {
      kind: "use",
      source: "family.profile",
      retire: "page",
      args: (page) => [page.pod, page.path],
    },
    receipts: { kind: "use", source: "family.receipts", retire: "target" },
    applyReceipt: {
      kind: "use",
      source: "family.apply-receipt",
      retire: "target",
      deps: ["receipts"],
    },
    captureReceipt: {
      kind: "use",
      source: "family.capture-receipt",
      retire: "target",
      deps: ["receipts"],
    },
    buildReceipt: {
      kind: "use",
      source: "family.build-receipt",
      retire: "page",
      deps: ["receipts", "profile"],
      args: (page) => [page.pod, page.path],
    },
    spec: {
      kind: "use",
      source: "family.spec",
      retire: "page",
      args: (page) => [page.pod, page.path],
    },
    pods: { kind: "use", source: "family.pods", retire: "never" },
  },
  verbs: {
    read: queryVerb(
      familyQueries["family.read"],
      { label: "Read family", review: "none", input: z.strictObject({ refusal }) },
      {
        ready: (_, input) => input.refusal,
        intent: (scope) => ({
          readId: crypto.randomUUID(),
          expectedRevision: scope.snapshot.work!.handle.revision,
        }),
        cancel: {
          key: familyQueries["family.cancel-read"],
          input: (request) => ({ readId: request.readId }),
        },
      },
    ),
    "close-inspector": pageVerb(
      { label: "Close inspector", input: z.object({}).default({}), chord: "Escape" },
      { page: () => ({ inspector: "" }) },
    ),
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
    saved: queryVerb(
      familyQueries["family.saved"],
      {
        label: "Read saved family",
        review: "none",
        input: z.strictObject({ request: familyReads["family.saved"].input, refusal }),
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => input.request,
      },
    ),
    open: commandVerb(
      "family.observe",
      {
        label: "Open family member",
        review: "none",
        input: z.strictObject({ source: podMemberSourceSchema, refusal }),
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ source: input.source }),
      },
    ),
    apply: commandVerb(
      "family.apply",
      {
        label: "Apply family",
        review: "shown",
        chord: "Mod+Enter",
        input: z.strictObject({ refusal }),
        says: "Preview this exact family draft, then apply the sealed plan",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: async (scope) => {
          const preview = await prepareCommand(scope, "family.plan", {}, NATIVE_APPLY_WAIT_S);
          return { ...preview, plan: familyPlanResultSchema.parse(preview.response) };
        },
        intent: (_scope, _input, _answers, ticket) => ({
          plan: familyPlanResultSchema.parse((ticket?.evidence as { plan?: unknown })?.plan).id,
          include: "all",
        }),
      },
    ),
    capture: commandVerb(
      "family.capture",
      {
        label: "Save family to pod",
        review: "none",
        input: z.strictObject({ pod: z.string(), spec: z.string().optional(), refusal }),
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ pod: input.pod, ...(input.spec ? { spec: input.spec } : {}) }),
        lands: (result) => {
          const member = z
            .object({ member: z.object({ pod: z.string(), path: z.string() }) })
            .parse(result).member;
          return { pod: member.pod, path: member.path };
        },
      },
    ),
    build: commandVerb(
      "family.build",
      {
        label: "Build .rfa",
        review: "shown",
        input: z.strictObject({ source: podMemberSourceSchema.nullable(), refusal }),
        says: "Review the saved member's exact hash, then build those bytes",
      },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (scope, input) => ({ source: input.source, target: scope.snapshot.target }),
        intent: (_scope, _input, _answers, ticket) => ({
          source: podMemberSourceSchema.parse((ticket?.evidence as { source?: unknown })?.source),
        }),
      },
    ),
    "attach-spec": commandVerb(
      "family.attach-spec",
      { label: "Attach PDF", review: "none", input: commands["family.attach-spec"].input },
      { intent: (_, input) => input },
    ),
  },
  panes: {
    anatomy: {
      label: "Family anatomy",
      purpose: "Inspect authored family geometry",
      draws: ["profile", "receipts", "applyReceipt", "captureReceipt", "buildReceipt"],
      verbs: ["read"],
    },
    table: {
      label: "Family parameters",
      purpose: "Edit one family's parameters across its types",
      draws: ["profile", "receipts", "applyReceipt", "captureReceipt", "buildReceipt"],
      verbs: [],
    },
    doc: {
      label: "Family document",
      purpose: "Inspect attached cut-sheet evidence",
      draws: ["spec"],
      verbs: [],
    },
    work: {
      label: "Family Work",
      purpose: "Review keyed cells and original receipts",
      draws: ["receipts"],
      verbs: [],
    },
    spec: {
      label: "Family members",
      purpose: "Open a saved model into the family draft",
      draws: ["pods", "profile"],
      verbs: Object.assign(
        (row: unknown) => ((row as { source?: unknown } | null)?.source ? ["open"] : []),
        { ids: ["open"] },
      ),
    },
    history: {
      label: "Saved family readings",
      purpose: "Inspect immutable captures",
      draws: [],
      verbs: Object.assign(
        (row: unknown) => ((row as { readingId?: unknown } | null)?.readingId ? ["saved"] : []),
        { ids: ["saved"] },
      ),
    },
  },
  layout: split(
    "family-body",
    { axis: "h", sized: "end", size: 340 },
    split(
      "family-main",
      { axis: "v", sized: "end", size: 160 },
      split(
        "family-audit",
        { axis: "v", sized: "start", size: 220 },
        gate("editing", pane("anatomy")),
        gate("editing", pane("table")),
      ),
      gate("editing", pane("work")),
    ),
    split(
      "family-support",
      { axis: "v", sized: "end", size: 240 },
      gate("editing", pane("doc")),
      split(
        "family-members",
        { axis: "v", sized: "start", size: 240 },
        gate("editing", pane("spec")),
        gate("history", pane("history")),
      ),
    ),
  ),
  predicates: { editing: (page) => page.stage !== "history" },
  stages: {
    audit: {
      word: "Auditing",
      panes: ["anatomy", "table", "doc", "work", "spec"],
      verbs: ["capture", "close-inspector"],
    },
    apply: {
      word: "Applying",
      panes: ["anatomy", "table", "doc", "work", "spec"],
      verbs: ["apply", "build", "capture", "close-inspector"],
    },
    history: { word: "History", panes: ["history"], verbs: ["close-inspector"] },
  },
  stageOrder: ["audit", "apply", "history"],
};
