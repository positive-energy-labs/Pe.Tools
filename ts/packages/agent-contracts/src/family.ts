/** Family UI projections of immutable readings. */
import { z } from "zod";
import { parsedDocViewSchema } from "./grounded-doc.ts";
import {
  diagnosticSchema,
  familyExecutionOptionsSchema,
  ffPlanEntrySchema,
  ffReceiptSchema,
  revitDataIssueSchema,
} from "./families.ts";
import { routeBindingsSchema } from "./route-state.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { settingsFieldStateSchema } from "./settings.ts";
import { trichotomyAgentMask } from "./trichotomy.ts";

/** `/family` Work: an immutable capture baseline plus keyed JSON-pointer cells. */
export const familyDraftSchema = z
  .object({
    /** Immutable draft baseline; it is not a claim about current Revit state. */
    reading: z.string().nullable().default(null),
    spec: z
      .object({ member: z.object({ pod: z.string(), path: z.string() }), doc: parsedDocViewSchema })
      .nullable()
      .default(null),
    cells: z.record(z.string(), settingsFieldStateSchema).default({}),
    /** When the Reading these staged rungs rest on was taken, on the host's clock. The change mark compares against this. */
    takenAt: z.string().nullable().default(null),
  })
  .strict();
export type FamilyDraft = z.infer<typeof familyDraftSchema>;

export const familyDraftRouteState = {
  route: "family",
  title: "Family",
  description:
    "A captured family draft baseline with cells keyed by JSON pointer. Propose through cells.*.proposal; a person stages reviewed values before plan or apply.",
  schema: familyDraftSchema,
  agentWriteMask: trichotomyAgentMask(),
  commands: {
    attach_spec: {
      description:
        "Parse a PDF path, URL, or uploaded bytes and attach its portable pages and blocks beside a captured family member.",
      actor: "any",
      input: z
        .object({
          member: z.object({ pod: z.string().min(1), path: z.string().min(1) }),
          source: z.union([
            z.object({ path: z.string().min(1) }).strict(),
            z.object({ url: z.url() }).strict(),
            z.object({ fileName: z.string().min(1), base64: z.string().min(1) }).strict(),
          ]),
        })
        .strict(),
    },
  },
} satisfies RouteStateSpec<typeof familyDraftSchema>;

export const specDocSchema = parsedDocViewSchema;
export type SpecDoc = z.infer<typeof specDocSchema>;

import { podMemberSourceSchema } from "./settings.ts";
import { observationSchema } from "./reading.ts";

/* ── Evidence projection (mirror of C# FamilyModelEvidence, camelCase) ──────── */

const familyEvidenceValueSourceSchema = z.enum([
  "AuthoredGlobal",
  "AuthoredTypeOverride",
  "Formula",
  "RevitDefault",
  "Unresolved",
]);

const familyEvidenceProvenanceSchema = z.enum(["Exact", "Inferred", "Unresolved"]);

const familyEvidenceResolvedValueSchema = z.object({
  value: z.string().nullish(),
  source: familyEvidenceValueSourceSchema,
  provenance: familyEvidenceProvenanceSchema,
  formula: z.string().nullish(),
});

const familyEvidenceParameterSchema = z.object({
  name: z.string(),
  isShared: z.boolean(),
  propertiesGroup: z.string().nullish(),
  valuesPerType: z.record(z.string(), familyEvidenceResolvedValueSchema),
});

const familyEvidenceDiagnosticSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  provenance: familyEvidenceProvenanceSchema,
  confidence: z.number().nullish(),
});

/** Revit evidence carries only the Reading for the document it describes. */
const fixtureEvidenceSchema = z.object({
  typeNames: z.array(z.string()),
  parameters: z.array(familyEvidenceParameterSchema),
  diagnostics: z.array(familyEvidenceDiagnosticSchema),
  reading: observationSchema,
  origin: z.enum(["capture", "build"]),
  familyName: z.string(),
  rfaPath: z.string().nullish(),
});
export const familyEvidenceSchema = z.union([
  z.object({
    // A capture is scoped by the action's exact document lifetime, never by address: an
    // Edit Family document has no path until it is saved.
    observedAt: z.iso.datetime(),
    familyName: z.string(),
    modelJson: z.string(),
    unmodeledCount: z.number(),
    coverage: z.record(z.string(), z.string()),
    issues: z.array(revitDataIssueSchema),
    /**
     * By parameter name: that it measures something, and the unit THIS family document renders it
     * in (an open .rfa has its own project units). Evidence beside the spec — `modelJson` authors a
     * portable family and does not carry one document's display settings.
     */
    parameterUnits: z
      .record(
        z.string(),
        z.object({
          specTypeId: z.string(),
          typeId: z.string().nullish(),
          label: z.string().nullish(),
          symbol: z.string().nullish(),
        }),
      )
      .optional(),
    origin: z.literal("capture"),
    rfaPath: z.string().nullish(),
    /** The capture's run folder (`output/<runId>`); its `unmodeled.json` holds the facts. */
    run: z.string().nullish(),
  }),
  fixtureEvidenceSchema,
]);
/* ── The document ──────────────────────────────────────────────────────────── */

export const familyProjectionSchema = z.object({
  bindings: routeBindingsSchema,
  stage: z.enum(["author", "evidence"]).optional(),
  doc: specDocSchema.nullish(),
  evidence: familyEvidenceSchema.nullish(),
  plan: z
    .object({
      captureId: z.string().optional(),
      source: podMemberSourceSchema,
      spec: z.string(),
      entry: ffPlanEntrySchema,
      executionOptions: familyExecutionOptionsSchema.optional(),
    })
    .nullish(),
  apply: z
    .object({ receipts: z.array(ffReceiptSchema), diagnostics: z.array(diagnosticSchema) })
    .nullish(),
  build: z
    .object({
      reading: observationSchema,
      familyName: z.string(),
      outputPath: z.string(),
      templatePath: z.string(),
      converged: z.boolean(),
      residueCount: z.number(),
    })
    .nullish(),
});
export type FamilyDocument = z.infer<typeof familyProjectionSchema>;
