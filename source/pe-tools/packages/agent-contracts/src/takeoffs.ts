import { z } from "zod";

import { type RouteStateSpec } from "./route-state.ts";
import { observationSchema } from "./reading.ts";
import { addressSchema } from "./target.ts";
import { documentRefSchema } from "./target.ts";

const pointSchema = z.tuple([z.number(), z.number()]);
const worldLoopsSchema = z
  .array(z.array(z.tuple([z.number(), z.number()]).readonly()).readonly())
  .readonly();
const roomEditSchema = z.object({
  name: z.string().optional(),
  type: z
    .enum([
      "bedroom",
      "primary bedroom",
      "full bath",
      "powder",
      "kitchen",
      "dining",
      "office",
      "laundry",
      "great room",
      "exercise",
      "mechanical",
      "hall",
    ])
    .optional(),
  ceilingFt: z.number().optional(),
  people: z.number().optional(),
  lightingW: z.number().optional(),
  equipSensible: z.number().optional(),
  equipLatent: z.number().optional(),
  ventilationCfm: z.number().optional(),
});

const resolutionSchema = z.object({
  subject: z.string(),
  flag: z.string(),
  verb: z.enum(["accept", "dismiss"]),
  at: z.string(),
  runId: z.string(),
});

export type Resolution = z.infer<typeof resolutionSchema>;

const modelViewSchema = z.object({
  view: z.string(),
  label: z.string(),
  replayPath: z.string().nullable(),
});

export type ModelView = z.infer<typeof modelViewSchema>;

const roomDataSchema = z.object({
  people: z.number(),
  lightingW: z.number(),
  equipSensible: z.number(),
  equipLatent: z.number(),
  ventilationCfm: z.number(),
});

export const takeoffRegionAnalysisSchema = z.object({
  state: z.enum(["current", "stale", "unmeasured"]),
  runId: z.string().nullable().default(null),
  floorZ: z.number().nullable().default(null),
  ceilingZ: z.number().nullable().default(null),
  hold: z.string().nullable().default(null),
});

const modelRoomSchema = z.object({
  analysis: takeoffRegionAnalysisSchema.nullable().optional(),
  guid: z.string(),
  elementId: z.number().nullable(),
  name: z.string(),
  type: roomEditSchema.shape.type.unwrap(),
  sqft: z.number(),
  ceilingFt: z.number(),
  label: pointSchema,
  flags: z.array(z.string()),
  decisions: z.array(resolutionSchema),
  provenance: z.object({ runId: z.string(), sourceRoomId: z.string(), sourceSqft: z.number() }),
  r10: z
    .object({
      identifier: z.number(),
      fileIdentity: z.string(),
      syncedAt: z.string(),
      lastSyncedSqft: z.number(),
    })
    .nullable(),
  data: roomDataSchema.nullable(),
  outer: z.array(pointSchema).nullable(),
  holes: z.array(z.array(pointSchema)),
});

export type ModelRoom = z.infer<typeof modelRoomSchema>;
export type RoomType = ModelRoom["type"];
export type RoomData = NonNullable<ModelRoom["data"]>;

export const partitionReviewSchema = z.object({
  source: z.object({
    runId: z.string().min(1).nullable(),
    documentKey: z.string().min(1),
    zoneKey: z.string().min(1),
  }),
  zone: z.object({ key: z.string(), name: z.string(), loops: z.array(z.array(pointSchema)) }),
  shapes: z.array(
    z.object({
      original: z
        .object({
          runId: z.string(),
          sourceRoomId: z.string(),
          disposition: z.enum(["accepted", "held", "void", "excluded"]).nullable(),
          reason: z.string().nullable(),
        })
        .optional(),
      id: z.string(),
      kind: z.enum(["room", "residue"]),
      disposition: z.enum(["accepted", "held", "void", "excluded"]).nullable(),
      reason: z.string().nullish().default(null),
      sqft: z.number().nullable(),
      label: pointSchema.nullable(),
      loops: z.array(z.array(pointSchema)),
    }),
  ),
});
export type PartitionReviewData = z.infer<typeof partitionReviewSchema>;

const modelZoneSchema = z.object({
  zone: z.object({
    guid: z.string(),
    elementId: z.number().nullable(),
    key: z.string(),
    ordinal: z.number(),
    lane: modelViewSchema,
    color: z.string(),
    loops: worldLoopsSchema,
    declaredSqft: z.number(),
    bounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }),
  }),
  stage: z.enum(["declared", "registered", "partitioned", "reviewed", "data", "synced", "drifted"]),
  tags: z.array(z.string()),
  name: z.string(),
  rooms: z.array(modelRoomSchema),
  residues: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      rawSqft: z.number(),
      label: pointSchema,
      outer: z.array(pointSchema),
      holes: z.array(z.array(pointSchema)),
    }),
  ),
  heldSqft: z.number(),
  runs: z.array(
    z.object({
      runId: z.string(),
      created: z.number(),
      rebound: z.number(),
      held: z.number(),
      orphaned: z.number(),
      failures: z.number(),
      declaredSqft: z.number(),
      roomSqft: z.number(),
      claimedWallSqft: z.number(),
      excludedSqft: z.number(),
    }),
  ),
  driftSqft: z.number().nullable(),
  savedReview: partitionReviewSchema.nullable().optional(),
});

export type ModelZone = z.infer<typeof modelZoneSchema>;
export type Phase = ModelZone["stage"];

export const candidateRegionSchema = z.object({
  elementId: z.number(),
  typeName: z.string(),
  view: z.string(),
  color: z.string(),
  sqft: z.number(),
  role: z.string().nullable(),
  guid: z.string().nullable(),
  blob: z.string(),
  loops: z.array(z.array(pointSchema)),
});

export type CandidateRegion = z.infer<typeof candidateRegionSchema>;

const liveRegionSchema = z.object({
  analysis: modelRoomSchema.shape.analysis,
  elementId: z.number(),
  role: z.string(),
  guid: z.string(),
  sqft: z.number(),
  roomType: z.string().optional(),
  blob: z.string(),
  outer: z.array(pointSchema),
  holes: z.array(z.array(pointSchema)),
});

export type LiveRegion = z.infer<typeof liveRegionSchema>;

// ADR 0011 deleted takeoffs.views with the raster, and with it the per-view FilledRegion count.
// A field that is always 0 is a lie, so it is gone rather than restored.
const viewFactsSchema = z.object({
  name: z.string(),
  level: z.string(),
});
export type ViewFacts = z.infer<typeof viewFactsSchema>;

const modelStatusSchema = z.object({
  systems: z.array(z.object({ guid: z.string(), tag: z.string() })),
});
export type RegistrySystem = z.infer<typeof modelStatusSchema>["systems"][number];

export const takeoffCarrierPreflightSchema = z.object({
  stage: z.enum(["Adoption", "Materialization"]),
  status: z.enum(["ready", "needs-initialization"]),
  missingCarrierGuids: z.array(z.string()),
});
export type TakeoffCarrierPreflight = z.infer<typeof takeoffCarrierPreflightSchema>;

const detectedRoomSchema = z.object({
  id: z.string(),
  rawSqft: z.number(),
  perimeterFt: z.number(),
  meanCeilingFt: z.number(),
  label: pointSchema,
  flags: z.array(z.string()),
  outer: z.array(pointSchema),
});
export type DetectedRoom = z.infer<typeof detectedRoomSchema>;

const detectedResidueSchema = z.object({
  id: z.string(),
  reason: z.string(),
  rawSqft: z.number(),
  label: pointSchema,
  outer: z.array(pointSchema),
});

export const partitionRunSchema = z.object({
  /** Exact returned geometry; absent until the partition producer supplies this projection. */
  review: partitionReviewSchema.nullable().optional(),
  levelName: z.string(),
  elevation: z.number(),
  created: z.number(),
  held: z.number(),
  rebound: z.number(),
  orphaned: z.number(),
  domainSqft: z.number(),
  claimedWallSqft: z.number(),
  excludedResidueSqft: z.number(),
  totalSqft: z.number(),
  profile: z.string(),
  failures: z.array(z.string()),
  rooms: z.array(detectedRoomSchema),
  residues: z.array(detectedResidueSchema),
  regions: z.array(liveRegionSchema),
});
export type PartitionRun = z.infer<typeof partitionRunSchema>;

const takeoffModelSchema = z.object({
  docName: z.string(),
  r10Path: z.string().nullable(),
  lanes: z.array(modelViewSchema),
  zones: z.array(modelZoneSchema),
  systems: z.array(
    z.object({
      guid: z.string(),
      tag: z.string(),
      zoneKeys: z.array(z.string()),
      sensibleBtuh: z.number(),
      overCap: z.boolean(),
    }),
  ),
});
export type TakeoffModel = z.infer<typeof takeoffModelSchema>;
export type ModelSystem = TakeoffModel["systems"][number];

export const takeoffSnapshotSchema = z.object({
  reading: observationSchema,
  carriers: takeoffCarrierPreflightSchema,
  world: takeoffModelSchema,
  zoneFrs: z.array(candidateRegionSchema),
  regionsByZone: z.record(z.string(), z.array(liveRegionSchema)),
});
export type TakeoffSnapshot = z.infer<typeof takeoffSnapshotSchema>;

/** Immutable host-owned observation. A migrated capture has no fabricated Revit target. */
export const takeoffCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live"), target: documentRefSchema }),
    z.object({
      kind: z.literal("legacy-unknown"),
      archiveId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
  ]),
  capturedAt: z.iso.datetime(),
  snapshot: takeoffSnapshotSchema,
});
export type TakeoffCapture = z.infer<typeof takeoffCaptureSchema>;
export const takeoffCaptureSummarySchema = takeoffCaptureSchema
  .omit({ snapshot: true })
  .extend({ document: addressSchema, title: z.string() });
const liveCaptureSchema = takeoffCaptureSchema.extend({
  provenance: z.object({ kind: z.literal("live"), target: documentRefSchema }),
});
export const takeoffObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty"), target: documentRefSchema }),
  z.strictObject({
    kind: z.literal("reading"),
    target: documentRefSchema,
    previous: liveCaptureSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("ready"),
    target: documentRefSchema,
    capture: liveCaptureSchema,
  }),
  z.strictObject({
    kind: z.literal("failed"),
    target: documentRefSchema,
    error: z.string(),
    previous: liveCaptureSchema.optional(),
  }),
]);
export type TakeoffObservation = z.infer<typeof takeoffObservationSchema>;

/** Lightweight wire projection. Geometry is fetched once by immutable identity. */
export const takeoffObservationStatusSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty"), target: documentRefSchema }),
  z.strictObject({
    kind: z.literal("reading"),
    target: documentRefSchema,
    previousId: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("ready"), target: documentRefSchema, captureId: z.string() }),
  z.strictObject({
    kind: z.literal("failed"),
    target: documentRefSchema,
    error: z.string(),
    previousId: z.string().optional(),
  }),
]);
export type TakeoffObservationStatus = z.infer<typeof takeoffObservationStatusSchema>;

const stagedRoomEditSchema = z.object({
  roomId: z.string(),
  base: roomEditSchema,
  next: roomEditSchema,
});
export type StagedRoomEdit = z.infer<typeof stagedRoomEditSchema>;

// Parse older Work without retaining its former page fields or discarding authored proposals.
const takeoffsDocumentSchema = z.object({
  staged: z.array(stagedRoomEditSchema).default([]),
  adoptPatches: z
    .record(
      z.string(),
      z.object({
        checked: z.boolean().optional(),
        name: z.string().optional(),
        systemTag: z.string().optional(),
      }),
    )
    .default({}),
  decisions: z.record(z.string(), z.enum(["accept", "dismiss"])).default({}),
  reviewFlags: z.record(z.string(), z.array(z.string())).default({}),
});
export type TakeoffsRouteDocument = z.infer<typeof takeoffsDocumentSchema>;

export const takeoffsRouteState = {
  route: "takeoffs",
  title: "Takeoffs",
  description:
    "Authored room proposals, adoption choices and review judgments. Model geometry is read from takeoffs.snapshot; durable saved observations are at /takeoffs/observations.",
  schema: takeoffsDocumentSchema,
  agentWriteMask: [
    ["staged", "*"],
    ["adoptPatches", "*"],
    ["decisions", "*"],
    ["reviewFlags", "*"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof takeoffsDocumentSchema>;

/** Historical file choices are an explicit per-view seed, never an authored or native binding. */
export const takeoffLegacySelectionSchema = z.strictObject({
  folder: z.string().nullable(),
  r10: z.string().nullable(),
});
