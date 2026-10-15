import { z } from "zod";
import { documentRefSchema } from "./target.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ductsAnalysisSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("document") }),
  z.strictObject({ kind: z.literal("equipment"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("terminal"), id: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("group"), id: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal("space-text"), text: z.string().trim().min(1).max(200) }),
]);
export const ductsAnalysisRequestSchema = z
  .strictObject({
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("fresh"), target: documentRefSchema }),
      z.strictObject({ kind: z.literal("artifact"), id: hash }),
    ]),
    selector: ductsAnalysisSelectorSchema,
    projection: z.enum(["summary", "terminals", "path"]).default("summary"),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.strictObject({ offset: z.number().int().nonnegative(), basis: hash }).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.cursor && input.source.kind === "fresh")
      ctx.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Pagination must reuse an artifact.",
      });
  });
export type DuctsAnalysisRequest = z.infer<typeof ductsAnalysisRequestSchema>;

const reason = z.strictObject({ code: z.string(), count: z.number().int(), message: z.string() });
const row = z.strictObject({
  kind: z.enum(["equipment", "terminal", "path"]),
  id: z.number().int(),
  label: z.string(),
  groupIds: z.array(z.string()),
  requiredEspNowInWg: z.number().nullable(),
  requiredEspStagedInWg: z.number().nullable(),
  availableFanStaticInWg: z.number().nullable(),
  flowCfm: z.number().nullable(),
  spaceText: z.string().nullable(),
  detail: z.string().nullable(),
  servedGroupState: z.enum(["observed", "unknown"]).nullable(),
  classificationParts: z.array(
    z.strictObject({
      classification: z.string(),
      nowInWg: z.number().nullable(),
      stagedInWg: z.number(),
    }),
  ),
  path: z
    .strictObject({
      terminalId: z.number().int(),
      componentKind: z.enum(["friction", "fitting", "tap-branch", "tap-straight", "terminal"]),
      lossInWg: z.number().nullable(),
      coefficient: z.number().nullable(),
      table: z.string().nullable(),
      velocityPressureInWg: z.number().nullable(),
      velocityFpm: z.number().nullable(),
      lookup: z
        .strictObject({
          result: z.enum(["Co", "Cb", "Cs"]),
          x: z.number(),
          y: z.number().nullable(),
          xLabel: z.string(),
          yLabel: z.string().nullable(),
        })
        .nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
});
export const ductsAnalysisResponseSchema = z.strictObject({
  analysisId: hash,
  artifact: z.strictObject({
    id: hash,
    url: z.string(),
    sha256: hash,
    byteSize: z.number().int(),
    format: z.literal("ducts-analysis-v1"),
  }),
  mode: z.enum(["fresh", "historical"]),
  target: documentRefSchema,
  work: z.strictObject({
    kind: z.enum(["canonical", "observed-only"]),
    revision: z.number().int().nullable(),
  }),
  freshness: z.strictObject({
    state: z.enum(["fresh", "historical", "changed", "unknown"]),
    observedAt: z.string(),
    reason: z.string().nullable(),
  }),
  selection: z.strictObject({
    state: z.enum(["matched", "not-found", "ambiguous"]),
    total: z.number().int(),
    candidates: z.array(z.number()).max(100),
  }),
  completeness: z.strictObject({
    basis: z.literal("staged-demand"),
    verdict: z.enum(["complete", "partial", "unknown"]),
    reasons: z.array(reason),
    expectedTerminals: z.number().int(),
    reachedTerminals: z.number().int(),
    pricedTerminals: z.number().int(),
    spaceTextHave: z.number().int(),
    spaceTextOf: z.number().int(),
  }),
  coverage: z.strictObject({
    groups: z.number().int(),
    equipment: z.number().int(),
    terminals: z.number().int(),
    scope: z.string(),
  }),
  rows: z.array(row).max(100),
  page: z.strictObject({
    total: z.number().int(),
    returned: z.number().int(),
    nextCursor: z.strictObject({ offset: z.number().int(), basis: hash }).nullable(),
  }),
});
export type DuctsAnalysisResponse = z.infer<typeof ductsAnalysisResponseSchema>;
