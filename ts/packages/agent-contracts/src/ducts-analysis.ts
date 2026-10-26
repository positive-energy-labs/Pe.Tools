import { z } from "zod";
import { ductsApplyInputSchema, ductPortPinSchema } from "./ducts.ts";
import { workKeySchema } from "./route-state.ts";
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
        "apply-request",
      ])
      .describe(
        "apply-request builds an immutable historical native-write candidate from a supported artifact only; download its exact payload, obtain approval and revalidate before preview/apply. It neither stages Work nor writes Revit. components reports whole-component stated-design flow status, which alone is not pressure certification; optional hydraulics reports prescribed-flow TOTAL-pressure closure with its own status, physical coverage, reasons and required fan head; flows pages physical joints, ordered line subruns, and flow-only station-arm/curve-continuity edges with signed CFM. Mass-only edges have null length and assert no pressure-loss law. The v5 artifact stores complete witness element records in top-level witnessElements; each stored component holds ordered witnessElements indices. Dereference those indices to assemble its exact componentWitness for canonical Work staging; no numeric recomputation. Hydraulic law evidence is losslessly interned in top-level hydraulicLaws; each stored hydraulics record holds ordered lawIndices, which dereference to its exact canonical lawEvidence array including duplicates. Effective input is input{encoding:gzip-base64,data,sha256,byteSize}; data gunzips to exact UTF-8 JSON, with sha256 and byteSize over those uncompressed bytes. Raw acquisition bodyUtf8, headers and hashes remain unchanged. Older artifact downloads retain exact bytes; unsupported projection formats refuse without recomputation. Normal responses are limited to100 rows and65536 UTF-8 bytes; oversized rows refuse with artifact id.",
      )
      .default("summary"),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.strictObject({ offset: z.number().int().nonnegative(), basis: hash }).optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.projection === "apply-request" &&
      (input.source.kind !== "artifact" ||
        input.cursor ||
        !["document", "group"].includes(input.selector.kind))
    )
      ctx.addIssue({
        code: "custom",
        path: ["projection"],
        message: "apply-request requires an artifact, document/group selection and no cursor.",
      });
    if (input.cursor && input.source.kind === "fresh")
      ctx.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Pagination must reuse an artifact.",
      });
  });
export type DuctsAnalysisRequest = z.infer<typeof ductsAnalysisRequestSchema>;

/**
 * The first call, as the guidance shows it. `source` and `selector` are objects, never strings:
 * Claude-backed sessions (Oct 21-25) kept passing `source:"fresh"` and got `expected object`.
 * Parsed by the schema in tests, so the guidance cannot drift from it.
 */
export const DUCTS_ANALYSIS_FIRST_CALL = JSON.stringify({
  source: { kind: "fresh", target: { session: "<session>", openId: "<openId>" } },
  selector: { kind: "document" },
  projection: "summary",
});

const reason = z.strictObject({ code: z.string(), count: z.number().int(), message: z.string() });
/**
 * How far an inferred join stands from the evidence (pressure-drop ledger, 2026-10-19: inference
 * may compute, never conclude), measured, never guessed: `near-miss` (a sub-inch, opposed, centred
 * open-to-open join of one classification), `stretched` (any other join the rule accepts), and
 * `anomalous` (a join made against the evidence: a reversed connector, a part placed inside a host,
 * classes a person joined anyway). Worst last.
 */
export const DUCT_INFERENCE_GRADES = ["near-miss", "stretched", "anomalous"] as const;
export type DuctInferenceGrade = (typeof DUCT_INFERENCE_GRADES)[number];
/** One thing the survey found: what the route assumed about it, if anything, and who clears it. */
export const ductFindingSchema = z.strictObject({
  id: z.string(),
  kind: z.string(),
  elementIds: z.array(z.number().int()),
  note: z.string(),
  assumed: z.string().nullable(),
  clearer: z.enum(["route", "pea", "person"]),
  /** An inferred join's grade; null or absent on a finding that joins nothing. */
  grade: z.enum(DUCT_INFERENCE_GRADES).nullable().optional(),
  /** A possible missed join is advisory and carries the measured gap and both open ports. */
  gapIn: z.number().nonnegative().optional(),
  connectors: z.tuple([z.string(), z.string()]).optional(),
  /** The group a finding is about when it is about a whole group (`no-fan`); absent otherwise. */
  groupId: z.string().nullable().optional(),
});
export type DuctFinding = z.infer<typeof ductFindingSchema>;
const row = z.strictObject({
  kind: z.enum(["equipment", "terminal", "path", "circuit", "port", "component", "flow"]),
  id: z.number().int(),
  label: z.string(),
  /** The element's equipment tag (the label parameter's value, `PE_G___TagInstance` by default); match a name like "FC-23" here, not on `label` (family / type). */
  tag: z.string().nullable(),
  groupIds: z.array(z.string()),
  requiredEspNowInWg: z.number().nullable(),
  requiredEspStagedInWg: z.number().nullable(),
  availableFanStaticInWg: z.number().nullable(),
  flowCfm: z.number().nullable(),
  /** Where a terminal row's `flowCfm` came from: "override" | "load-preview:<tag>" | "revit:<airflow slot>". */
  flowSource: z.string().nullable(),
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
      hydraulics: z
        .strictObject({
          status: z.enum(["complete-for-prescribed-flow", "partial", "inconsistent"]),
          mode: z.literal("prescribed-flow-demand"),
          physicalPortCount: z.number().int(),
          coveredPhysicalPortCount: z.number().int(),
          physicalPartCount: z.number().int(),
          coveredPhysicalPartCount: z.number().int(),
          lawCount: z.number().int(),
          pressureComponentCount: z.number().int(),
          maxPressureResidualInWg: z.number().nullable(),
          fanHeadCount: z.number().int(),
          fanHeadsTruncated: z.boolean(),
          fanHeads: z
            .array(
              z.strictObject({
                id: z.string(),
                elementId: z.number().int(),
                flowCfm: z.number().nullable(),
                requiredExternalTotalPressureInWg: z.number().nullable(),
              }),
            )
            .max(20),
          unknownFanHeads: z.number().int(),
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
        })
        .nullable(),
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
      externalExchange: z
        .strictObject({
          ownerOutwardCfm: z.number().nullable(),
          inflowCfm: z.number().nullable(),
          source: z.string(),
          derivation: z.enum(["fan-design", "fan-continuity"]).nullable(),
          fromComponentId: z.string().nullable(),
        })
        .nullable(),
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
const applyRequestReference = z.strictObject({
  artifact: z.strictObject({
    id: hash,
    url: z.string(),
    sha256: hash,
    byteSize: z.number().int(),
    format: z.literal("ducts-apply-request-v1"),
  }),
  mode: z.literal("historical-candidate-requires-approval-and-revalidation"),
  sourceAnalysisId: hash,
  payloadSha256: hash,
  payloadByteSize: z.number().int(),
  counts: z.strictObject({
    fittings: z.number().int(),
    terminals: z.number().int(),
    components: z.number().int(),
    equipment: z.number().int(),
    unpricedRuleInstances: z.number().int(),
  }),
});
export const ductsApplyRequestProducerSchema = z.looseObject({
  version: z.string().min(1),
  lane: z.enum(["dev", "installed"]),
  executablePath: z.string().min(1),
  processId: z.number().int().positive(),
  serviceName: z.string().min(1),
  sourceRoot: z.string().nullable(),
  installedRoot: z.string().nullable(),
});
/** A read-only candidate; no approval, preview, native execution or currentness is implied. */
export const ductsApplyRequestArtifactSchema = z.strictObject({
  format: z.literal("ducts-apply-request-v1"),
  createdAt: z.string().datetime(),
  builder: ductsApplyRequestProducerSchema,
  source: z.strictObject({
    analysisId: hash,
    byteSize: z.number().int(),
    producer: ductsApplyRequestProducerSchema,
    target: documentRefSchema,
    process: z.strictObject({ pid: z.number().int(), startUtcUnixMs: z.number() }),
    work: z.strictObject({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      jsonSha256: hash,
    }),
    freshness: z.strictObject({
      state: z.literal("fresh"),
      observedAt: z.string(),
      reason: z.string().nullable(),
    }),
    effectiveInput: z.strictObject({ sha256: hash, byteSize: z.number().int() }),
    snapshotJsonSha256: hash,
    tablesJsonSha256: hash,
    acquisitions: z
      .array(
        z.strictObject({
          key: z.string(),
          request: z.unknown(),
          status: z.number().int(),
          headers: z.record(z.string(), z.string()),
          sha256: hash,
          byteSize: z.number().int(),
        }),
      )
      .length(2),
  }),
  group: z.string(),
  payload: ductsApplyInputSchema,
  payloadSha256: hash,
  payloadByteSize: z.number().int(),
  unpriced: z.array(
    z.strictObject({ ruleKey: z.string(), id: z.number().int(), reason: z.string().nullable() }),
  ),
});
export const ductsAnalysisResponseSchema = z.strictObject({
  analysisId: hash,
  applyRequest: applyRequestReference.nullable(),
  artifact: z.strictObject({
    id: hash,
    url: z.string(),
    sha256: hash,
    byteSize: z.number().int(),
    format: z.literal("ducts-analysis-v5"),
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
  /**
   * The airflow read slot (a walk step, pressure-drop ledger 2026-10-20): the TerminalFlow slot the
   * snapshot read, and every air flow parameter the terminals carry with how many of them hold a
   * nonzero value, best first (the built-in `Flow` is the connector's). Pea proposes a slot as a claim;
   * a person picks it on the page.
   */
  airflow: z.strictObject({
    slot: z.string(),
    candidates: z
      .array(
        z.strictObject({
          slot: z.string(),
          where: z.string(),
          shared: z.boolean(),
          have: z.number().int(),
          of: z.number().int(),
        }),
      )
      .max(20),
  }),
  rows: z.array(row).max(100),
  /** The survey's findings; the summary projection carries them, person first, trimmed last under the byte budget. */
  findings: z.array(ductFindingSchema),
  /** Every finding counted, never budgeted: what the trimmed list cannot show. */
  findingCounts: z.strictObject({
    byKind: z.record(z.string(), z.number().int()),
    /** The same counts keyed `kind:grade` for graded joins, `kind` otherwise; what the cases join on. */
    byKindAndGrade: z.record(z.string(), z.number().int()),
    byClearer: z.strictObject({
      route: z.number().int(),
      pea: z.number().int(),
      person: z.number().int(),
    }),
  }),
  page: z.strictObject({
    total: z.number().int(),
    returned: z.number().int(),
    truncated: z.boolean(),
    nextCursor: z.strictObject({ offset: z.number().int(), basis: hash }).nullable(),
  }),
});
export type DuctsAnalysisResponse = z.infer<typeof ductsAnalysisResponseSchema>;
