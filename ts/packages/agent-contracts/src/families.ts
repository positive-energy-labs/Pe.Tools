import { z } from "zod";

import { isRecord, type RouteStateSpec } from "./route-state.ts";
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
  before: z.json(),
  after: z.json(),
});
export const ffPlanEntrySchema = z.object({
  /** The id the name resolved to at plan; null when the name refused (no loaded family, ambiguous, not editable). */
  familyId: z.number().nullish(),
  familyName: z.string(),
  planHash: z.string(),
  changes: z.array(changeSchema),
  runEffects: z.array(z.string()),
  refusals: z.array(diagnosticSchema),
  warnings: z.array(revitDataIssueSchema),
});
export type FfPlanEntry = z.infer<typeof ffPlanEntrySchema>;
type FamilyPlanDecisionEntry = {
  familyId?: number | null;
  familyName: string;
  planHash: string;
  changes: readonly unknown[];
  runEffects: readonly unknown[];
  refusals: readonly unknown[];
};
export const ffReceiptSchema = z.object({
  familyId: z.number(),
  familyName: z.string(),
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
 * The `revit.catalog.loaded-families` request that answers a scope's family names AND every type.
 * F-J1-12: the collector lists types only for a Rows/Full view, and caps them at 10 per family
 * unless the budget says otherwise; without both, every family reads typeless. Always filtered:
 * a filterless read is the whole document (M13-2).
 */
export const familyCatalogRequest = (scope: AppliedFilter) => ({
  filter: scope,
  projection: { view: "Rows" as const },
  budget: { maxEntries: FAMILY_CATALOG_LIMIT, maxSamplesPerEntry: FAMILY_CATALOG_LIMIT },
});

/**
 * Why the Families door refused a write: one code per refusal branch. The web draws the code and
 * its parts; `agentHint` is prose for Pea and is never parsed.
 */
export type FamiliesRefusalCode =
  | "exclusion-held"
  | "exclusion-author"
  | "unknown-family"
  | "no-scope"
  | "unknown-family-type"
  | "scope-truncated"
  | "scope-unresolved"
  | "types-truncated"
  | "document-unavailable"
  | "catalog-unreachable";
export type FamiliesRefusal = {
  ok: false;
  kind: "refused";
  code: FamiliesRefusalCode;
  /** The cell keys refused, on `unknown-family-type`. */
  cells?: FamilyCellAddress[];
  /** The family names refused, on scope-name, exclusion and `types-truncated` refusals. */
  families?: string[];
  agentHint: string;
};

/** Why a scope's catalog cannot answer its families and types, or null when it can. */
export function familyCatalogProblem(catalog: {
  summary: { truncated: boolean };
  families: readonly { familyName: string; typeCount?: number; types: readonly unknown[] }[];
  issues?: readonly { message: string }[];
}): { code: FamiliesRefusalCode; message: string; families?: string[] } | null {
  if (catalog.summary.truncated)
    return {
      code: "scope-truncated",
      message: `the scope resolves more than ${FAMILY_CATALOG_LIMIT} families; narrow it`,
    };
  if (!catalog.families.length)
    return {
      code: "scope-unresolved",
      message: `scope resolved to no loaded families: ${catalog.issues?.map((issue) => issue.message).join("; ") || "no loaded family matches it"}`,
    };
  const short = catalog.families.find(
    (family) => family.typeCount != null && family.types.length < family.typeCount,
  );
  return short
    ? {
        code: "types-truncated",
        message: `the catalog listed ${short.types.length} of ${short.typeCount} types of "${short.familyName}"`,
        families: [short.familyName],
      }
    : null;
}

/**
 * One proposed cell value on the `/families` audit: a family type's parameter cell and the value
 * someone proposes for it. Pea and a person write the same shape and are told apart by `by`. It is
 * authored Work, not a result — it survives a reload. The address is a family NAME, a type and the
 * EXACT Revit parameter name, because that is what a Family Foundry patch keys on
 * (`patch.types.<typeName>.<parameter>`). Never a family element id: every LoadFamily after an edit
 * replaces the Family element, so only the name is stable across applies.
 */
export const familyCellValueSchema = z
  .object({
    value: z.string(),
    unit: z.string().min(1).optional(),
    storageType: z.enum(["String", "Integer", "Double", "ElementId", "None"]),
  })
  .strict();
/** A family cell value; a measured one carries its unit to the patch as `{ value, unit }`. */
export type FamilyCellValue = z.infer<typeof familyCellValueSchema>;

/** The one word for a family cell: a measured value reads with its unit. */
export const showFamilyCell = (value: unknown): string => {
  const cell = familyCellValueSchema.parse(value);
  return cell.unit === undefined ? cell.value : `${cell.value} ${cell.unit}`;
};
export const familyCellStateSchema = trichotomyCellSchema(familyCellValueSchema);
export type FamilyCellState = z.infer<typeof familyCellStateSchema>;

export interface FamilyCellAddress {
  familyName: string;
  typeName: string;
  parameter: string;
}

const familyCellAddressTupleSchema = z.tuple([z.string().min(1), z.string(), z.string()]);

/** JSON tuple encoding is collision-free even when names contain separators. */
export const familyCellKey = ({ familyName, typeName, parameter }: FamilyCellAddress): string =>
  JSON.stringify(familyCellAddressTupleSchema.parse([familyName, typeName, parameter]));

export const familyCellAddress = (key: string): FamilyCellAddress => {
  const [familyName, typeName, parameter] = familyCellAddressTupleSchema.parse(JSON.parse(key));
  return { familyName, typeName, parameter };
};

const familyCellKeySchema = z.string().refine(
  (key) => {
    try {
      return familyCellKey(familyCellAddress(key)) === key;
    } catch {
      return false;
    }
  },
  { error: "a family cell key must be a canonical [familyName,typeName,parameter] JSON tuple" },
);

/** Only a declared numeric storage type permits numeric coercion; Text always preserves its bytes. */
export const patchValue = (
  text: string,
  storageType: FamilyCellValue["storageType"],
): string | number | boolean => {
  if (storageType === "Integer" && (text === "true" || text === "false")) return text === "true";
  if (
    (storageType === "Double" || storageType === "Integer") &&
    text.trim() !== "" &&
    Number.isFinite(Number(text))
  )
    return Number(text);
  return text;
};

/**
 * The patch member one family's staged cells generate, without its `$schema`, and the cell keys it
 * consumed. Web files it; the host proves a planned member is exactly this before a plan may retire
 * those cells. Null when the family has nothing staged.
 */
export function familyStagedPatch(
  cells: Record<string, FamilyCellState>,
  familyName: string,
): {
  familyName: string;
  spec: { select: { names: string[] }; patch: { types: Record<string, Record<string, unknown>> } };
  keys: string[];
} | null {
  const types: Record<string, Record<string, unknown>> = {};
  const keys: string[] = [];
  for (const [key, cell] of Object.entries(cells)) {
    const address = familyCellAddress(key);
    if (address.familyName !== familyName || !cell.staged) continue;
    const { value, unit, storageType } = cell.staged.value;
    (types[address.typeName] ??= {})[address.parameter] =
      unit === undefined ? patchValue(value, storageType) : { value, unit };
    keys.push(key);
  }
  return keys.length === 0
    ? null
    : { familyName, spec: { select: { names: [familyName] }, patch: { types } }, keys };
}

export const familyFilterCellSchema = trichotomyCellSchema(appliedScopeSchema).strict();
export type FamilyFilterCell = z.infer<typeof familyFilterCellSchema>;

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
    /**
     * The audited scope is a cell (F-J1-10): Pea proposes one, only the person stages it, and plan
     * reads the staged one. A bare filter is old Work, so it fails closed.
     */
    scope: familyFilterCellSchema.default({}),
    /**
     * Families held back from plan, keyed by family NAME, each with who held it back. An all-digit
     * key is an old element id, so it fails closed rather than reading as a name.
     */
    excluded: z
      .record(
        z.string().regex(/\D/, "an exclusion key is a family name, never an element id"),
        z.object({ by: exclusionAuthorSchema }).strict(),
      )
      .default({}),
    cells: z.record(familyCellKeySchema, familyCellStateSchema).default({}),
    executionOptions: familyExecutionOptionsSchema.optional(),
    /** The pod the person plans the draft in and saves it to (F-B-5b). The person's choice; Pea never writes it. */
    pod: z.string().min(1).optional(),
  })
  .strict();
export type FamiliesRouteDocument = z.infer<typeof familiesDocumentSchema>;

/** The scope the person staged: the only one the matrix audits and plan resolves. */
export const stagedFilter = (doc: FamiliesRouteDocument): AppliedFilter | null =>
  doc.scope.staged?.value ?? null;

/**
 * The included plan hashes an apply must reproduce exactly, keyed by the id each name resolved to in
 * that sealed plan. Server and client share this.
 */
export const familiesIncluded = (
  plan: { entries: readonly FamilyPlanDecisionEntry[] },
  excluded: FamilyExclusions,
): Record<string, string> =>
  Object.fromEntries(
    plan.entries
      .filter(
        (entry) =>
          entry.familyId != null &&
          !Object.hasOwn(excluded, entry.familyName) &&
          entry.refusals.length === 0 &&
          (entry.changes.length > 0 || entry.runEffects.length > 0),
      )
      .map((entry) => [String(entry.familyId), entry.planHash]),
  );

/** The planned families held back, and by whom: what the plan sheet states line by line. */
export const familiesExcluded = (
  plan: { entries: readonly FamilyPlanDecisionEntry[] },
  excluded: FamilyExclusions,
) =>
  plan.entries.flatMap((entry) => {
    const held = Object.hasOwn(excluded, entry.familyName) ? excluded[entry.familyName] : undefined;
    return held ? [{ familyName: entry.familyName, by: held.by }] : [];
  });

/** What start fresh can carry over from unreadable Work, each piece only on the person's press. */
export type FamiliesSalvage = { familyNames: string[]; familyIds: number[]; scope?: AppliedFilter };

export const familiesRouteState = {
  route: "families",
  title: "Families",
  finds: [
    "set",
    "change",
    "parameter",
    "parameters",
    "value",
    "values",
    "type",
    "types",
    "family",
    "families",
    "propose",
  ],
  description:
    'Family Foundry: propose scope.proposal first = { value: { categoryNames, familyNames, placementScope } } (exact family names from op:revit.catalog.loaded-families); the person stages it, and plan audits only the staged scope. Then propose cells.<key>.proposal, where <key> is [familyName,typeName,parameter] of a type listed in the route read\'s scopeTypes (the staged scope, else the proposed one) (the family NAME, never an element id); do not wait for the person to stage the scope. A person stages reviewed cells before plan or apply. Hold a family back with excluded.<familyName> = { by: "pea" }; the plan sheet names who held it back, and only the person lifts their own.',
  schema: familiesDocumentSchema,
  // Pea writes proposals only. A staged value reaches plan only through a person's review.
  agentWriteMask: [
    ["scope", "proposal"],
    ["excluded"],
    ...trichotomyAgentMask(),
    ["executionOptions"],
  ],
  // Planning and applying are the `families.plan` and `families.apply` workflows. Neither is
  // a route command, so neither can write into authored Work.
  commands: {},
  // Old Work held exclusions by element id (`excludedIds`, then id-keyed `excluded`), then by name;
  // the page resolves ids to current names and re-excludes by name. Its scope was a bare filter
  // (or `plan.scope` before that): offered back, it is staged only by the person's press.
  salvage: (raw): FamiliesSalvage => {
    const doc = isRecord(raw) ? raw : {};
    const keys = isRecord(doc.excluded) ? Object.keys(doc.excluded) : [];
    const ids = [
      ...(Array.isArray(doc.excludedIds) ? doc.excludedIds : []),
      ...keys.filter((key) => /^\d+$/.test(key)).map(Number),
    ];
    const scopeCell = isRecord(doc.scope) ? doc.scope : {};
    const scope = [
      doc.scope,
      isRecord(scopeCell.staged) ? scopeCell.staged.value : undefined,
      isRecord(doc.plan) ? doc.plan.scope : undefined,
    ]
      .map((candidate) => appliedScopeSchema.safeParse(candidate))
      .find((parsed) => parsed.success)?.data;
    return {
      familyNames: keys.filter((key) => !/^\d+$/.test(key)),
      familyIds: ids.filter((id): id is number => Number.isSafeInteger(id)),
      ...(scope ? { scope } : {}),
    };
  },
} satisfies RouteStateSpec<typeof familiesDocumentSchema>;
