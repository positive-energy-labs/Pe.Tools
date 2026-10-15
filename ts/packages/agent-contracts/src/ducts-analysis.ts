import { z } from "zod";
import { ductPortPinSchema } from "./ducts.ts";
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
    projection: z
      .enum([
        "summary",
        "terminals",
        "path",
        "circuits",
        "circuit-path",
        "ports",
        "components",
        "flows",
      ])
      .describe(
        "components reports whole-component stated-design flow status, not pressure certification; flows pages physical joints, ordered line subruns, and flow-only station-arm/curve-continuity edges with signed CFM. Mass-only edges have null length and assert no pressure-loss law. The v4 artifact stores complete witness element records in top-level witnessElements; each stored component holds ordered witnessElements indices. Dereference those indices to assemble its exact componentWitness for canonical Work staging; no numeric recomputation. Effective input is input{encoding:gzip-base64,data,sha256,byteSize}; data gunzips to exact UTF-8 JSON, with sha256 and byteSize over those uncompressed bytes. Raw acquisition bodyUtf8, headers and hashes remain unchanged. Older artifact downloads retain exact bytes; unsupported projection formats refuse without recomputation. Normal responses are limited to100 rows and65536 UTF-8 bytes; oversized rows refuse with artifact id.",
      )
      .default("summary"),
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
  kind: z.enum(["equipment", "terminal", "path", "circuit", "port", "component", "flow"]),
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
  component: z
    .strictObject({
      id: z.string(),
      status: z.enum(["unique", "underdetermined", "inconsistent"]),
      nodeCount: z.number().int(),
      edgeCount: z.number().int(),
      cycleRank: z.number().int(),
      unknownEdges: z.number().int(),
      maxResidualCfm: z.number().nullable(),
      reasonCount: z.number().int(),
      reasonsTruncated: z.boolean(),
      reasons: z
        .array(
          z.strictObject({
            code: z.string(),
            elementId: z.number().nullable(),
            message: z.string(),
          }),
        )
        .max(20),
      pressureCertification: z.literal("not-established-by-flow-check"),
    })
    .nullable(),
  flow: z
    .strictObject({
      componentId: z.string(),
      componentStatus: z.enum(["unique", "underdetermined", "inconsistent"]),
      elementId: z.number().int(),
      id: z.string(),
      kind: z.enum([
        "joint",
        "duct-subrun",
        "station-arm",
        "curve-continuity",
        "fitting-arm",
        "passive",
      ]),
      from: z.string(),
      to: z.string(),
      lengthFt: z.number().nullable(),
      signedCfm: z.number().nullable(),
      source: z.enum(["conservation", "staged-constraint"]).nullable(),
    })
    .nullable(),
  port: z
    .strictObject({
      origin: z.literal("native-snapshot"),
      direction: z.string(),
      classification: z.string().nullable(),
      connection: z
        .strictObject({ elementId: z.number().int(), connector: z.number().int() })
        .nullable(),
      reciprocal: z.boolean(),
      section: z.strictObject({
        shape: z.string(),
        diameterIn: z.number().nullable(),
        widthIn: z.number().nullable(),
        heightIn: z.number().nullable(),
        areaFt2: z.number().nullable(),
      }),
      uniqueId: z.string().nullable(),
      index: z.number().int(),
      pin: ductPortPinSchema.nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  circuit: z
    .strictObject({
      id: z.string(),
      uniqueId: z.string(),
      status: z.enum(["complete-for-declared-design", "partial"]),
      basis: z.literal("balanced-design-demand"),
      requiredExternalTotalPressureInWg: z.number().nullable(),
      requiredExternalStaticPressureInWg: z.number().nullable(),
      manufacturerEsp: z.null(),
      inletPort: z.number().int().nullable(),
      outletPort: z.number().int().nullable(),
      inletElements: z.number().int(),
      outletElements: z.number().int(),
      reasonCount: z.number().int(),
      reasonsTruncated: z.boolean(),
      reasons: z.array(
        z.strictObject({
          code: z.string(),
          elementId: z.number().int().nullable(),
          message: z.string(),
        }),
      ),
    })
    .nullable(),
  path: z
    .strictObject({
      terminalId: z.number().int(),
      circuitId: z.string().nullable(),
      circuitSide: z.enum(["inlet", "outlet"]).nullable(),
      balancingInWg: z.number().nullable(),
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
    format: z.literal("ducts-analysis-v4"),
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
    physicalCircuits: z.number().int(),
    passiveEquipment: z.number().int(),
    unassignedEquipmentPorts: z.number().int(),
    admittedCircuitTerminals: z.number().int(),
    reachedCircuitTerminals: z.number().int(),
  }),
  rows: z.array(row).max(100),
  page: z.strictObject({
    total: z.number().int(),
    returned: z.number().int(),
    truncated: z.boolean(),
    nextCursor: z.strictObject({ offset: z.number().int(), basis: hash }).nullable(),
  }),
});
export type DuctsAnalysisResponse = z.infer<typeof ductsAnalysisResponseSchema>;
