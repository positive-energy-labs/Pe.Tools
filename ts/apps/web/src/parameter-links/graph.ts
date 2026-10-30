import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";
import { z } from "zod";
import {
  familyCaptureSchema,
  gate,
  pane,
  parameterLinkProfileSchema,
  parameterLinksRouteState,
  split,
  stagedParameterProfile,
  transitionPatches,
  type ParameterLinksDocument,
  type RouteGraph,
} from "@pe/agent-contracts";
import { parameterLinksAddress } from "../../../../packages/agent-contracts/src/routes/parameter-links";
import { commandVerb, queryVerb, workVerb } from "#/shell/verbs";
import type { BindingScope } from "#/shell/mount-owner";
import { applyRefusal, profileSummary } from "./model";

export const parameterLinksPageSchema = z.object({
  rail: parameterLinksAddress.fields.rail.schema,
});
export type ParameterLinksPage = z.output<typeof parameterLinksPageSchema>;
export type ParameterLinksScope = BindingScope<ParameterLinksPage, ParameterLinksDocument>;

export function latestLinks(value: unknown) {
  return (
    familyCaptureSchema
      .array()
      .parse(value ?? [])
      .find((capture) => capture.reading.kind === "parameter-links") ?? null
  );
}

export function parameterLinksBinding(id: string, row: unknown, scope: ParameterLinksScope) {
  const saved = scope.work ? stagedParameterProfile(scope.work.doc) : null;
  const capture = latestLinks(scope.readings.links?.value ?? scope.readings.links?.previous);
  const reading = capture?.reading.kind === "parameter-links" ? capture.reading.value : null;
  const refusal =
    scope.target.kind !== "document"
      ? "An open project document is required"
      : !scope.work
        ? "Work has not been read yet"
        : null;
  return {
    subject: null,
    args:
      id === "edit"
        ? { ...(row as object), refusal }
        : id === "apply"
          ? {
              readingId: reading?.evaluated ? (capture?.id ?? null) : null,
              refusal:
                refusal ??
                (!reading?.evaluated || !capture?.id
                  ? "Preview this draft before applying."
                  : null) ??
                (!scope.readings.links?.current
                  ? "Preview this draft before applying."
                  : applyRefusal(scope.work?.doc ?? null, reading)),
            }
          : {
              refusal:
                refusal ??
                (id === "preview"
                  ? !saved
                    ? "Author a draft profile first."
                    : null
                  : id === "previewProposal" && !scope.work?.doc.profile.suggestion
                    ? "Pea has proposed no profile"
                    : null),
            },
  };
}

const guarded = z.object({ refusal: z.string().nullable().default(null) });
const read = (label: string, evaluate: boolean, subject: "edit" | "suggestion" = "edit") =>
  queryVerb(
    familyQueries["parameter-links.read"],
    { label, review: "none", input: guarded },
    {
      ready: (_, input) => input.refusal,
      intent: () => ({ evaluate, ...(subject === "suggestion" ? { subject } : {}) }),
    },
  );

export const parameterLinksGraph: RouteGraph<ParameterLinksPage, ParameterLinksDocument> = {
  key: "parameter-links",
  address: "parameter-links",
  name: "Parameter Links",
  needs: "project",
  work: parameterLinksRouteState.schema,
  fields: {
    rail: { ...parameterLinksAddress.fields.rail, role: "pose", agent: false },
  },
  cells: [
    {
      segment: null,
      key: "profile",
      groupOf: () => ["profile"],
      show: (value) => profileSummary(parameterLinkProfileSchema.parse(value)),
      commit: "plan",
    },
  ],
  readings: {
    links: { kind: "use", source: "parameter-links.links", retire: "target" },
    receipts: { kind: "use", source: "parameter-links.receipts", retire: "target" },
    options: {
      kind: "use",
      source: "parameter-links.options",
      retire: "target",
    },
  },
  verbs: {
    edit: workVerb(
      {
        label: "edit profile",
        input: guarded.extend({
          profile: parameterLinkProfileSchema.nullable(),
          expectedRevision: z.number().int(),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; review and retry"),
        patches: (_, input) =>
          input.profile
            ? transitionPatches([], "profile", {}, { kind: "set", rung: { value: input.profile } })
            : transitionPatches([], "profile", {}, { kind: "clear" }),
      },
    ),
    refresh: read("refresh", false),
    preview: read("preview", true),
    previewProposal: read("preview Pea's suggestion", true, "suggestion"),
    apply: commandVerb(
      "parameter-links.apply",
      {
        label: "apply links",
        review: "none",
        input: guarded.extend({
          readingId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        }),
      },
      {
        ready: (_, input) =>
          input.refusal ?? (!input.readingId ? "Preview this draft before applying." : null),
        intent: (_, input) => ({ readingId: input.readingId! }),
      },
    ),
  },
  panes: {
    profile: {
      label: "profile",
      purpose: "Edit and review the shared parameter linkage profile",
      draws: ["links", "receipts", "options"],
      verbs: [],
    },
    evaluation: {
      label: "evaluation",
      purpose: "Inspect projected writes and native updater status",
      draws: ["links"],
      verbs: [],
    },
  },
  layout: split(
    "parameter-links-body",
    { axis: "h", sized: "end", size: 520 },
    pane("profile"),
    gate("evaluation-open", pane("evaluation")),
  ),
  predicates: { "evaluation-open": (page) => page.rail === "open" },
  stages: {
    links: {
      word: "links",
      panes: ["profile", "evaluation"],
      verbs: ["refresh", "preview", "previewProposal"],
    },
  },
  pick: false,
};
