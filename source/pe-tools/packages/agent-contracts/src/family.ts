/**
 * `route:family` — the sibling slice beside `route:settings` for the /family surface.
 *
 * The settings slice owns the authored family.json document and its field trichotomy;
 * this slice owns everything the family surface needs that is NOT authored truth:
 *   - `doc`: an OCR'd spec sheet (markdown blocks only — geometry stays in the parse
 *     cache, same law as family-types),
 *   - `evidence`: the resolved per-type value/provenance projection Revit returned,
 *     stamped with where it came from so staleness is renderable, never silent.
 *
 * Pea acts on this slice through commands only (empty agent write mask). Proposals
 * against the family live in `route:settings` fields, where the human review
 * lifecycle already exists.
 */
import { z } from "zod";
import { defineRouteState, routeBindingSchema } from "./route-state.ts";
import { specDocSchema } from "./family-types.ts";
import { settingsDocumentIdSchema } from "./settings.ts";

/* ── Evidence projection (mirror of C# FamilyModelEvidence, camelCase) ──────── */

export const familyEvidenceValueSourceSchema = z.enum([
  "AuthoredGlobal",
  "AuthoredTypeOverride",
  "Formula",
  "RevitDefault",
  "Unresolved",
]);

export const familyEvidenceProvenanceSchema = z.enum(["Exact", "Inferred", "Unresolved"]);

export const familyEvidenceResolvedValueSchema = z.object({
  value: z.string().nullish(),
  source: familyEvidenceValueSourceSchema,
  provenance: familyEvidenceProvenanceSchema,
  formula: z.string().nullish(),
});

export const familyEvidenceParameterSchema = z.object({
  name: z.string(),
  isShared: z.boolean(),
  propertiesGroup: z.string().nullish(),
  valuesPerType: z.record(z.string(), familyEvidenceResolvedValueSchema),
});

export const familyEvidenceDiagnosticSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  provenance: familyEvidenceProvenanceSchema,
  confidence: z.number().nullish(),
});

/** Where the evidence came from — the staleness contract. A UI compares
 * `documentVersionToken` against the open settings snapshot's token: equal means
 * the evidence describes what you're editing; different means dashed/stale. */
export const familyEvidenceOriginSchema = z.object({
  origin: z.enum(["capture", "build"]),
  capturedAt: z.string(),
  target: z.string().nullish(),
  documentId: settingsDocumentIdSchema.nullish(),
  documentVersionToken: z.string().nullish(),
  familyName: z.string(),
  rfaPath: z.string().nullish(),
});

export const familyEvidenceSchema = z.object({
  typeNames: z.array(z.string()),
  parameters: z.array(familyEvidenceParameterSchema),
  diagnostics: z.array(familyEvidenceDiagnosticSchema),
  from: familyEvidenceOriginSchema,
});
export type FamilyEvidence = z.infer<typeof familyEvidenceSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

/** Parser-extracted figures/diagram crops — ids only; geometry stays in the parse
 * cache. Pea may cite an image id as a proposal source; the parser measured its
 * region, so image citations ground exactly (never estimated). */
export const familyDocImageSchema = z.object({
  id: z.string(),
  page: z.number(),
  category: z.string(),
});

export const familyDocumentSchema = z.object({
  binding: routeBindingSchema,
  doc: specDocSchema.extend({ images: z.array(familyDocImageSchema).default([]) }).nullish(),
  evidence: familyEvidenceSchema.nullish(),
});
export type FamilyDocument = z.infer<typeof familyDocumentSchema>;

export const familyRouteState = defineRouteState({
  route: "family",
  title: "Family",
  description:
    "Anatomy, types, and spec grounding for one authored family.json. Authored edits and proposals live in route:settings; this slice carries the spec doc and Revit evidence.",
  key: "route:family",
  schema: familyDocumentSchema,
  // Pea never patches this slice directly — doc and evidence arrive via commands.
  agentWriteMask: [],
  commands: {
    parse_spec: {
      description:
        "OCR a manufacturer spec sheet / submittal PDF (LlamaParse) by URL and attach its markdown blocks. Then read blocks and write proposals into route:settings fields, citing sources.",
      input: z.object({ url: z.string().describe("Public URL of the PDF.") }),
      actor: "any",
    },
    capture_evidence: {
      description:
        "Capture the family open in the bound Revit session (revit.detail.family-model): stores the resolved per-type evidence projection here and returns the authored modelJson so it can seed or update a settings document. Targets the bound session; pass target to override.",
      input: z.object({ target: z.string().optional() }),
      actor: "any",
      recoversExternal: true,
    },
    build_evidence: {
      description:
        "Build the saved settings document into an .rfa (revit.apply.family-model) and store the evidence the build returned. Builds the SAVED revision — staged edits must be saved first. Targets the bound session; pass target to override.",
      input: z.object({
        documentId: settingsDocumentIdSchema,
        outputPath: z.string().optional().describe("Defaults to .artifacts/tmp/family/<path>.rfa"),
        modelDirectory: z.string().optional(),
        target: z.string().optional(),
      }),
      actor: "any",
      mutatesExternal: true,
    },
  },
});
