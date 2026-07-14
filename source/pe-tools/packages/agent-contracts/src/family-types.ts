/**
 * /family-types document — the collaborative state for the web Family Types editor.
 *
 * Mirrors the family document open in Revit's family editor (parameters × types,
 * formulas as first-class `@formula` cells) with the proposal → staged → pushed
 * trichotomy and orthogonal review marks. Speaks the repo's canonical parameter
 * language: cell addressing is NAME-based (the sanctioned name-first authoring idiom),
 * while `ParameterIdentity` rides along as carried data on each snapshot parameter.
 *
 * Geometry NEVER lives here — `state_changed` rebroadcasts the whole document on every
 * write, so the doc carries markdown blocks + a `parseId`; the grounded view is
 * refetched from the parse cache.
 */
import { z } from "zod";
import { defineRouteState, routeBindingSchema } from "./route-state.ts";
import {
  LOW_CONFIDENCE_REFINE_ERROR,
  cellProposalSchema,
  lowConfidenceIsFlagged,
  trichotomyAgentMask,
  trichotomyCellWithProposal,
} from "./trichotomy.ts";

/* ── Cell trichotomy — shared core + this route's provenance extension ────── */

/** Provenance in markdown coordinates — pea never sees a bbox; the UI resolves
 * geometry through the grounded-doc estimator (measured solid / estimated dashed). */
export const sourceRefSchema = z.object({
  blockId: z.string(),
  rowIdx: z.number().nullish(),
  colIdx: z.number().nullish(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/** String-valued trichotomy cell whose proposals carry markdown source refs. */
export const familyTypesCellSchema = trichotomyCellWithProposal(
  z.string(),
  cellProposalSchema(z.string()).extend({ source: sourceRefSchema.nullish() }),
);
export type FamilyTypesCell = z.infer<typeof familyTypesCellSchema>;

/* ── Snapshot (family.editor.snapshot, extended by the parallel C# wave) ────── */

/** Canonical ParameterIdentity, minted host-side via RevitParameterDefinition.CreateIdentity.
 * Cross-agent contract with Wave 1B — do not alter this shape. */
export const parameterIdentitySchema = z.object({
  key: z.string(),
  kind: z.string(),
  name: z.string(),
  builtInParameterId: z.number().nullish(),
  sharedGuid: z.string().nullish(),
  parameterElementId: z.number().nullish(),
});
export type ParameterIdentity = z.infer<typeof parameterIdentitySchema>;

/** One-level dims/arrays/nested associations via GetAssociated. Cross-agent contract. */
export const parameterAssociationsSchema = z.object({
  dimensions: z.array(z.string()),
  arrays: z.array(z.string()),
  nested: z.array(
    z.object({
      elementName: z.string(),
      elementId: z.string(),
      paramName: z.string(),
    }),
  ),
});
export type ParameterAssociations = z.infer<typeof parameterAssociationsSchema>;

export const familyTypesParamSchema = z.object({
  name: z.string(),
  isInstance: z.boolean(),
  isReadOnly: z.boolean(),
  isDeterminedByFormula: z.boolean().nullish(),
  isShared: z.boolean().nullish(),
  storageType: z.string(),
  dataType: z.string().nullish(),
  group: z.string().nullish(),
  formula: z.string().nullish(),
  /** typeName -> display-faithful value (AsValueString chain). */
  valuesPerType: z.record(z.string(), z.string()),
  /** Canonical parameter identity, carried data (Wave 1B attaches it host-side). */
  identity: parameterIdentitySchema.nullish(),
  /** Formula-graph ancestry (params this one's formula reads). */
  dependsOn: z.array(z.string()).nullish(),
  /** Formula-graph offspring (params whose formula reads this one). */
  dependents: z.array(z.string()).nullish(),
  associations: parameterAssociationsSchema.nullish(),
});
export type FamilyTypesParam = z.infer<typeof familyTypesParamSchema>;

export const familyTypesSnapshotSchema = z.object({
  familyName: z.string(),
  currentTypeName: z.string().nullish(),
  typeNames: z.array(z.string()),
  takenAt: z.string().nullish(),
  parameters: z.array(familyTypesParamSchema),
});
export type FamilyTypesSnapshot = z.infer<typeof familyTypesSnapshotSchema>;

/* ── Spec doc (markdown blocks only; geometry stays in the parse cache) ─────── */

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

/* ── The document ──────────────────────────────────────────────────────────── */

export const familyTypesDocumentSchema = z
  .object({
    binding: routeBindingSchema,
    snapshot: familyTypesSnapshotSchema.nullish(),
    doc: specDocSchema.nullish(),
    /** cellKey -> cell trichotomy state. */
    cells: z.record(z.string(), familyTypesCellSchema).default({}),
    pushedAt: z.string().nullish(),
  })
  // Post-patch invariant: a low-confidence proposal that isn't flagged is a silent risk.
  // Rejecting teaches pea the invariant through the returned zod error.
  .refine((document) => lowConfidenceIsFlagged(document.cells), {
    error: LOW_CONFIDENCE_REFINE_ERROR,
  });
export type FamilyTypesDocument = z.infer<typeof familyTypesDocumentSchema>;

export const familyTypesRouteState = defineRouteState({
  route: "family-types",
  key: "route:family-types",
  schema: familyTypesDocumentSchema,
  agentWriteMask: trichotomyAgentMask(),
  commands: {
    parse_spec: {
      description:
        "OCR a manufacturer spec sheet / submittal PDF (LlamaParse) by URL and attach its markdown blocks to the document. Then read blocks and propose values with provenance.",
      input: z.object({ url: z.string().describe("Public URL of the PDF.") }),
      actor: "any",
    },
    refresh_snapshot: {
      description:
        "Re-read the family open in Revit's family editor into the snapshot (parameters × types, formulas, identity, ancestry). Existing proposals and review marks are preserved. Targets the workspace's bound session; pass target to override.",
      input: z.object({ target: z.string().optional() }),
      actor: "any",
    },
    push: {
      description:
        "HUMAN ONLY. Apply every staged cell to Revit via family.editor.apply, fold successful values into the snapshot, and clear those cells. Failed edits stay staged. Targets the workspace's bound session; pass target to override.",
      input: z.object({ target: z.string().optional() }),
      actor: "human",
    },
  },
});

/* ── Cell keys ── `${param}::${type}`; formulas use the `@formula` pseudo-type. ──
   Param names may contain `::`, so keys split on the LAST `::`. */

export const FORMULA_TYPE = "@formula";

export function cellKey(paramName: string, typeName: string): string {
  return `${paramName}::${typeName}`;
}

export function formulaCellKey(paramName: string): string {
  return cellKey(paramName, FORMULA_TYPE);
}

export function splitCellKey(key: string): { paramName: string; typeName: string } {
  const idx = key.lastIndexOf("::");
  return idx < 0
    ? { paramName: key, typeName: "" }
    : { paramName: key.slice(0, idx), typeName: key.slice(idx + 2) };
}

export function isFormulaCellKey(key: string): boolean {
  return key.endsWith(`::${FORMULA_TYPE}`);
}
