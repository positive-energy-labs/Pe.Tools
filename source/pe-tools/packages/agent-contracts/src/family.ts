/** Family UI projections of immutable readings. */
import { z } from "zod";
import {
  diagnosticSchema,
  familyExecutionOptionsSchema,
  ffPlanEntrySchema,
  ffReceiptSchema,
  revitDataIssueSchema,
} from "./families.ts";
import { routeBindingsSchema } from "./route-state.ts";
export const specDocBlockSchema = z.object({
  id: z.string(),
  page: z.number(),
  kind: z.string(),
  md: z.string(),
});
export type SpecDocBlock = z.infer<typeof specDocBlockSchema>;

export const specDocSchema = z.object({
  parseId: z.string().nullish(),
  fileName: z.string(),
  blocks: z.array(specDocBlockSchema),
});
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
    origin: z.literal("capture"),
    rfaPath: z.string().nullish(),
    /** The capture's run folder (`output/<runId>`); its `unmodeled.json` holds the facts. */
    run: z.string().nullish(),
  }),
  fixtureEvidenceSchema,
]);
/* ── The document ──────────────────────────────────────────────────────────── */

/** Parser-extracted figures/diagram crops — ids only; geometry stays in the parse
 * cache. Pea may cite an image id as a proposal source; the parser measured its
 * region, so image citations ground exactly (never estimated). */
const familyDocImageSchema = z.object({
  id: z.string(),
  page: z.number(),
  category: z.string(),
});

export const familyProjectionSchema = z.object({
  bindings: routeBindingsSchema,
  stage: z.enum(["author", "evidence"]).optional(),
  doc: specDocSchema.extend({ images: z.array(familyDocImageSchema).default([]) }).nullish(),
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
