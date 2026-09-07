/**
 * `route:family` — the sibling slice beside `route:settings` for the /family surface.
 *
 * The settings slice owns the authored family.json document and its field trichotomy;
 * this slice owns everything the family surface needs that is NOT authored truth:
 *   - `doc`: an OCR'd spec sheet (markdown blocks only — geometry stays in the parse
 *     cache, same law as family-types),
 *   - `evidence`: the resolved per-type value/provenance projection Revit returned,
 *     stamped with the Revit document Reading so currency is renderable, never silent.
 *
 * Pea acts on this slice through commands only (empty agent write mask). Proposals
 * against the family live in `route:settings` fields, where the human review
 * lifecycle already exists.
 */
import { z } from "zod";
import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";
import { specDocSchema } from "./family-types.ts";
import { settingsDocumentIdSchema } from "./settings.ts";
import { readingSchema } from "./reading.ts";

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
  reading: readingSchema,
  origin: z.enum(["capture", "build"]),
  familyName: z.string(),
  rfaPath: z.string().nullish(),
});
export const familyEvidenceSchema = z.union([
  z.object({
    reading: readingSchema,
    familyName: z.string(),
    modelJson: z.string(),
    unmodeledCount: z.number(),
    coverage: z.record(z.string(), z.string()),
    origin: z.literal("capture"),
    rfaPath: z.string().nullish(),
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

const familyDocumentSchema = z.object({
  bindings: routeBindingsSchema,
  stage: z.enum(["author", "evidence"]).optional(),
  doc: specDocSchema.extend({ images: z.array(familyDocImageSchema).default([]) }).nullish(),
  evidence: familyEvidenceSchema.nullish(),
  build: z
    .object({
      reading: readingSchema,
      familyName: z.string(),
      outputPath: z.string(),
      templatePath: z.string(),
      converged: z.boolean(),
      residueCount: z.number(),
    })
    .nullish(),
});
export type FamilyDocument = z.infer<typeof familyDocumentSchema>;

export const familyRouteState = {
  route: "family",
  title: "Family",
  description:
    "Anatomy, types, and spec grounding for one authored family.json. Authored edits and proposals live in route:settings; this slice carries the spec doc and Revit evidence.",
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
        "Capture the family open in the bound Revit session: stores native modelJson, coverage and unmodeledCount. Use route:settings to author JSON and proposals. Formula outputs are not captured values.",
      input: z.object({ target: z.string().optional() }),
      actor: "any",
      recoversExternal: true,
    },
    build_evidence: {
      description:
        "Build the validated composed SAVED settings document into an .rfa and store its convergence/residue receipt. Save staged edits first. This does not capture parameter evidence or apply to an existing document.",
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
} satisfies RouteStateSpec<typeof familyDocumentSchema>;
