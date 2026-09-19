import { z } from "zod";

import type { RouteStateSpec } from "./route-state.ts";
import { trichotomyAgentMask, trichotomyCellSchema } from "./trichotomy.ts";

export const diagnosticSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  suggestion: z.string().nullish(),
});
export const revitDataIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["Info", "Warning", "Error"]),
  message: z.string(),
  familyName: z.string().nullish(),
  typeName: z.string().nullish(),
  parameterName: z.string().nullish(),
});
const changeSchema = z.object({
  section: z.string(),
  key: z.string(),
  kind: z.string(),
  mappedFrom: z.string().nullish(),
});
export const ffPlanEntrySchema = z.object({
  familyId: z.number(),
  familyName: z.string(),
  planHash: z.string(),
  changes: z.array(changeSchema),
  runEffects: z.array(z.string()),
  refusals: z.array(diagnosticSchema),
  warnings: z.array(revitDataIssueSchema),
});
export type FfPlanEntry = z.infer<typeof ffPlanEntrySchema>;
export const ffReceiptSchema = z.object({
  familyId: z.number(),
  familyName: z.string().nullish(),
  success: z.boolean(),
  converged: z.boolean(),
  error: z.string().nullish(),
  planHash: z.string().nullish(),
  residue: z.array(changeSchema),
  errors: z.array(z.string()),
  artifactDirectory: z.string().nullish(),
});
export type FfReceipt = z.infer<typeof ffReceiptSchema>;

/** What `families.capture` saw, per family, beside the members it filed; a failure files nothing. */
export const familiesCaptureEvidenceSchema = z.object({
  diagnostics: z.array(diagnosticSchema),
  families: z.array(
    z.object({
      familyId: z.number(),
      familyName: z.string().nullish(),
      success: z.boolean(),
      coverage: z.record(z.string(), z.string()).default({}),
      unmodeledCount: z.number().default(0),
      issues: z.array(revitDataIssueSchema).default([]),
      error: z.string().nullish(),
      /** The capture's run folder (`output/<runId>`); its `unmodeled.json` holds the facts. */
      run: z.string().nullish(),
    }),
  ),
});
export type FamiliesCaptureEvidence = z.infer<typeof familiesCaptureEvidenceSchema>;

export const familyExecutionOptionsSchema = z
  .object({
    singleTransaction: z.boolean().optional(),
    optimizeTypeOperations: z.boolean().optional(),
    enableCollectors: z.boolean().optional(),
    suppressWarnings: z.boolean().optional(),
  })
  .strict();
export type FamilyExecutionOptions = z.infer<typeof familyExecutionOptionsSchema>;

const appliedScopeSchema = z.object({
  categoryNames: z.array(z.string()),
  familyNames: z.array(z.string()),
  placementScope: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]),
});
export type AppliedFilter = z.infer<typeof appliedScopeSchema>;
/**
 * One page of the loaded-families catalog a scope may resolve to. The band's matrix and the host's
 * plan both read it at this budget, so they count the same families; more refuses rather than pages.
 */
export const FAMILY_CATALOG_LIMIT = 5000;

/**
 * One proposed cell value on the `/families` audit: a family type's parameter cell and the value
 * someone proposes for it. Pea and a person write the same shape and are told apart by `by`. It is
 * authored Work, not a result — it survives a reload. The address is a family, a type and the EXACT
 * Revit parameter name, because that is what a Family Foundry patch keys on
 * (`patch.types.<typeName>.<parameter>`).
 */
export const familyCellValueSchema = z.object({
  familyName: z.string(),
  value: z.string(),
});
export type FamilyCellValue = z.infer<typeof familyCellValueSchema>;
export const familyCellStateSchema = trichotomyCellSchema(familyCellValueSchema);
export type FamilyCellState = z.infer<typeof familyCellStateSchema>;

export interface FamilyCellAddress {
  familyId: number;
  typeName: string;
  parameter: string;
}

const familyCellAddressTupleSchema = z.tuple([z.number(), z.string(), z.string()]);

/** JSON tuple encoding is collision-free even when names contain separators. */
export const familyCellKey = ({ familyId, typeName, parameter }: FamilyCellAddress): string =>
  JSON.stringify(familyCellAddressTupleSchema.parse([familyId, typeName, parameter]));

export const familyCellAddress = (key: string): FamilyCellAddress => {
  const [familyId, typeName, parameter] = familyCellAddressTupleSchema.parse(JSON.parse(key));
  return { familyId, typeName, parameter };
};

const familyCellKeySchema = z.string().refine(
  (key) => {
    try {
      return familyCellKey(familyCellAddress(key)) === key;
    } catch {
      return false;
    }
  },
  { error: "a family cell key must be a canonical [familyId,typeName,parameter] JSON tuple" },
);

/** A typed cell value as the Family Foundry patch writes it: a JSON scalar stays one. */
export const patchValue = (text: string): string | number | boolean =>
  text === "true"
    ? true
    : text === "false"
      ? false
      : text.trim() !== "" && Number.isFinite(Number(text))
        ? Number(text)
        : text;

/**
 * The patch member one family's staged cells generate, without its `$schema`, and the cell keys it
 * consumed. Web files it; the host proves a planned member is exactly this before a plan may retire
 * those cells. Null when the family has nothing staged.
 */
export function familyStagedPatch(
  cells: Record<string, FamilyCellState>,
  familyId: number,
): {
  familyName: string;
  spec: { select: { names: string[] }; patch: { types: Record<string, Record<string, unknown>> } };
  keys: string[];
} | null {
  const types: Record<string, Record<string, unknown>> = {};
  const keys: string[] = [];
  let familyName: string | null = null;
  for (const [key, cell] of Object.entries(cells)) {
    const address = familyCellAddress(key);
    if (address.familyId !== familyId || !cell.staged) continue;
    familyName ??= cell.staged.value.familyName;
    (types[address.typeName] ??= {})[address.parameter] = patchValue(cell.staged.value.value);
    keys.push(key);
  }
  return familyName === null
    ? null
    : { familyName, spec: { select: { names: [familyName] }, patch: { types } }, keys };
}

/** Who held a family back. The route door checks it is the writer, so it is never just claimed. */
export const exclusionAuthorSchema = z.enum(["person", "pea"]);
export type FamilyExclusions = Record<string, { by: z.infer<typeof exclusionAuthorSchema> }>;

/**
 * The Families route document is authored Work and nothing else. The spec is the page's member
 * (one address, sent as `source`) or the members plan generates from staged cells;
 * plans and receipts are results. This document holds only the scope, keyed proposal/staged cells,
 * and what a human or pea held back.
 */
const familiesDocumentSchema = z
  .object({
    scope: appliedScopeSchema.nullable().default(null),
    /** Families held back from plan, keyed by family id, each with who held it back. */
    excluded: z
      .record(z.string().regex(/^\d+$/), z.object({ by: exclusionAuthorSchema }).strict())
      .default({}),
    cells: z.record(familyCellKeySchema, familyCellStateSchema).default({}),
    executionOptions: familyExecutionOptionsSchema.optional(),
  })
  .strict();
export type FamiliesRouteDocument = z.infer<typeof familiesDocumentSchema>;

/** The included plan hashes an apply must reproduce exactly. Server and client share this. */
export const familiesIncluded = (
  plan: { entries: readonly FfPlanEntry[] },
  excluded: FamilyExclusions,
): Record<string, string> =>
  Object.fromEntries(
    plan.entries
      .filter(
        (entry) =>
          !Object.hasOwn(excluded, String(entry.familyId)) &&
          entry.refusals.length === 0 &&
          (entry.changes.length > 0 || entry.runEffects.length > 0),
      )
      .map((entry) => [String(entry.familyId), entry.planHash]),
  );

/** The planned families held back, and by whom: what the plan sheet states line by line. */
export const familiesExcluded = (
  plan: { entries: readonly FfPlanEntry[] },
  excluded: FamilyExclusions,
) =>
  plan.entries.flatMap((entry) => {
    const held = excluded[String(entry.familyId)];
    return held ? [{ familyId: entry.familyId, by: held.by }] : [];
  });

export const familiesRouteState = {
  route: "families",
  title: "Families",
  description:
    'Family Foundry: author a scope and propose through cells.<key>.proposal, where <key> is [familyId,typeName,parameter] of a family type loaded in the scope. A person stages reviewed cells before plan or apply. Hold a family back with excluded.<familyId> = { by: "pea" }; the plan sheet names who held it back, and only the person lifts their own.',
  schema: familiesDocumentSchema,
  // Pea writes proposals only. A staged value reaches plan only through a person's review.
  agentWriteMask: [["scope"], ["excluded"], ...trichotomyAgentMask(), ["executionOptions"]],
  // Planning and applying are the `families.plan` and `families.apply` workflows. Neither is
  // a route command, so neither can write into authored Work.
  commands: {},
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
