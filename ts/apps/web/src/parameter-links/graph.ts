import { z } from "zod";
import {
  familyCaptureSchema,
  gate,
  pane,
  parameterLinkProfileSchema,
  parameterLinkDefinitionSchema,
  parameterLinksRouteState,
  split,
  stagedParameterProfile,
  transitionPatches,
  type ParameterLinksDocument,
  type RouteGraph,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { parameterLinksAddress } from "../../../../packages/agent-contracts/src/routes/parameter-links";
import { commandVerb, queryVerb, workVerb } from "#/shell/verbs";
import type { BindingScope } from "#/shell/mount-owner";
import { applyRefusal, profileSummary, sameProfile } from "./model";

// A local buffer can temporarily have no definitions. Saving still validates the Work contract.
const bufferProfile = parameterLinkProfileSchema.extend({
  definitions: z.array(parameterLinkDefinitionSchema),
});
const bufferSchema = z
  .object({ profile: bufferProfile, revision: z.number().int() })
  .nullable()
  .default(null);
export const parameterLinksPageSchema = z.object({
  rail: parameterLinksAddress.fields.rail.schema,
  buffer: bufferSchema,
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

export function parameterLinksBinding(id: string, _row: unknown, scope: ParameterLinksScope) {
  const saved = scope.work ? stagedParameterProfile(scope.work.doc) : null;
  const buffer = scope.page.buffer;
  const dirty = buffer !== null && !sameProfile(buffer.profile, saved);
  const capture = latestLinks(scope.readings.links?.value ?? scope.readings.links?.previous);
  const reading = capture?.reading.kind === "parameter-links" ? capture.reading.value : null;
  const unsaved = dirty
    ? "unsaved local edits — save the draft, then preview exactly what you will apply"
    : null;
  const refusal =
    scope.target.kind !== "document"
      ? "An open project document is required"
      : !scope.work
        ? "Work has not been read yet"
        : null;
  return {
    subject: null,
    args:
      id === "save"
        ? {
            profile: buffer?.profile ?? saved,
            expectedRevision: buffer?.revision ?? -1,
            refusal:
              refusal ??
              (!dirty ? "no unsaved local edits — the shared document already matches" : null),
          }
        : id === "apply"
          ? {
              readingId: reading?.evaluated ? (capture?.id ?? null) : null,
              refusal:
                refusal ??
                unsaved ??
                (!scope.readings.links?.current
                  ? "Preview this draft before applying."
                  : applyRefusal(scope.work?.doc ?? null, reading)),
            }
          : {
              refusal:
                refusal ??
                (id === "preview"
                  ? (unsaved ?? (!saved ? "save a draft first" : null))
                  : id === "previewProposal" && !scope.work?.doc.profile.suggestion
                    ? "Pea has proposed no profile"
                    : null),
            },
  };
}

const guarded = z.object({ refusal: z.string().nullable().default(null) });
const read = (label: string, evaluate: boolean, subject: "edit" | "suggestion" = "edit") =>
  queryVerb(
    "parameter-links.read",
    { label, review: "none", input: guarded },
    {
      ready: (_, input) => input.refusal,
      intent: () => ({ evaluate, ...(subject === "suggestion" ? { subject } : {}) }),
    },
  );

/** Cutover waits for kernel pre-read Work writes and hosted Target/URL isolation. */
export const parameterLinksGraph: RouteGraph<ParameterLinksPage, ParameterLinksDocument> = {
  key: "parameter-links",
  address: "parameter-links",
  name: "Parameter Links",
  needs: "project",
  work: parameterLinksRouteState.schema,
  fields: {
    rail: { ...parameterLinksAddress.fields.rail, role: "pose", agent: false },
    buffer: {
      ...field(bufferSchema, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "transient",
    },
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
      retire: "page",
      args: (page) => page.buffer,
    },
  },
  verbs: {
    save: workVerb(
      {
        label: "save draft",
        input: guarded.extend({
          profile: parameterLinkProfileSchema,
          expectedRevision: z.number().int(),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; your local edits are kept"),
        patches: (_, input) =>
          transitionPatches([], "profile", {}, { kind: "set", rung: { value: input.profile } }),
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
        input: guarded.extend({ readingId: z.string().regex(/^[a-f0-9]{64}$/) }),
      },
      {
        ready: (_, input) => input.refusal,
        intent: (_, input) => ({ readingId: input.readingId }),
      },
    ),
  },
  panes: {
    profile: {
      label: "profile",
      purpose: "Edit and review the shared parameter linkage profile",
      draws: ["links", "receipts", "options"],
      verbs: Object.assign((row: unknown) => (row === "profile" ? [] : ["save"]), {
        ids: ["save"],
      }),
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
