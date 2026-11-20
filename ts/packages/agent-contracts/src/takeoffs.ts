import { nativeResponseDefinitionSchema } from "@pe/host-contracts/decoders";
import type { TakeoffsSnapshot } from "@pe/host-contracts/generated";
import { z } from "zod";

import { observationSchema } from "./reading.ts";
import { addressSchema } from "./target.ts";
import { documentRefSchema } from "./target.ts";
import { nativeOutputSchema } from "./native-output-read.ts";

const pointSchema = z.tuple([z.number(), z.number()]);
const worldLoopsSchema = z
  .array(z.array(z.tuple([z.number(), z.number()]).readonly()).readonly())
  .readonly();
export const roomEditSchema = z.object({
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
  /** A person's designation of a hand-drawn region. */
  role: z.enum(["room", "zone"]).optional(),
});

const modelViewSchema = z.object({
  view: z.string(),
  label: z.string(),
  replayPath: z.string().nullable(),
});


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
  provenance: z.object({
    runId: z.string(),
    sourceRoomId: z.string(),
    sourceSqft: z.number(),
    originalIssue: z.string().optional(),
  }),
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
      /** Partition's Accounting.Excluded. */
      excludedSqft: z.number(),
      /** Partition's Accounting.Void. */
      voidSqft: z.number(),
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
  excludedSqft: z.number(),
  voidSqft: z.number(),
  totalSqft: z.number(),
  /** Where the zone's enclosure came from. */
  enclosureSource: z.string(),
  /** Why Partition held the run back, when it did. */
  hold: z.string().nullish(),
  failures: z.array(z.string()),
  rooms: z.array(detectedRoomSchema),
  residues: z.array(detectedResidueSchema),
  regions: z.array(liveRegionSchema),
});

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

export const takeoffUnreadableBlobSchema =
  nativeResponseDefinitionSchema<TakeoffsSnapshot.Res.TakeoffUnreadableBlob>(
    "takeoffs.snapshot",
    "TakeoffUnreadableBlob",
  );
export const takeoffSnapshotSchema = z.object({
  reading: observationSchema,
  carriers: takeoffCarrierPreflightSchema,
  world: takeoffModelSchema,
  unreadable: z.array(takeoffUnreadableBlobSchema).optional(),
  zoneFrs: z.array(candidateRegionSchema),
  regionsByZone: z.record(z.string(), z.array(liveRegionSchema)),
});
export type TakeoffSnapshot = z.infer<typeof takeoffSnapshotSchema>;

/** Immutable host-owned observation. */
export const takeoffCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.object({ kind: z.literal("live"), target: documentRefSchema }),
  capturedAt: z.iso.datetime(),
  snapshot: takeoffSnapshotSchema,
});
export type TakeoffCapture = z.infer<typeof takeoffCaptureSchema>;
/** What the host retains as one capture: a native snapshot with the display facts of its plans. */
export const takeoffSnapshotInput = z.object({
  target: documentRefSchema,
  snapshot: nativeOutputSchema("takeoffs.snapshot"),
  views: z.array(z.object({ name: z.string(), level: z.string() })),
});
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

/** A room's current edit as the host consumes it. */
export const stagedRoomEditSchema = z.object({
  roomId: z.string(),
  next: roomEditSchema,
});
export type StagedRoomEdit = z.infer<typeof stagedRoomEditSchema>;
export type RoomEdit = z.infer<typeof roomEditSchema>;
export type RoomEditField = keyof RoomEdit;

/** One canonical JSON tuple per cell address, the Families encoding rule. */
const tupleKey = (parts: readonly string[]) => JSON.stringify(parts);
const tupleSchema = z.tuple([z.string(), z.string()]);
const tupleOf = (key: string) => {
  const parts = tupleSchema.parse(JSON.parse(key));
  if (tupleKey(parts) !== key) throw Error("Expected a canonical Takeoffs cell key");
  return parts;
};
/** A room field's edit: `[roomId, field]`, its value that field's next value. */
export const takeoffEditKey = (roomId: string, field: RoomEditField) => tupleKey([roomId, field]);
export const takeoffEditAddress = (key: string) => {
  const [roomId, field] = tupleOf(key);
  if (!Object.hasOwn(roomEditSchema.shape, field)) throw Error(`Unknown Takeoffs room field ${field}`);
  return { roomId, field: field as RoomEditField };
};
/** A person's verdict on a solver flag: `[roomGuid, flag]`. */
export const takeoffDecisionKey = (roomGuid: string, flag: string) => tupleKey([roomGuid, flag]);
export const takeoffDecisionAddress = (key: string) => {
  const [roomGuid, flag] = tupleOf(key);
  return { roomGuid, flag };
};
/** A review flag on one shape of a zone's saved partition review: `[zoneKey, shapeKey]`. */
export const takeoffFlagKey = (zoneKey: string, shapeKey: string) => tupleKey([zoneKey, shapeKey]);

type StagedCells<V> = Record<string, { edit?: { value?: V } | null }>;

const stagedOf = <V>(cells: StagedCells<V>) =>
  Object.entries(cells).flatMap(([key, cell]) =>
    cell.edit?.value !== undefined ? [[key, cell.edit.value] as const] : [],
  );

/** Current room edits, one per room: what sync consumes. Optional suggestions never appear. */
export function stagedTakeoffEdits(doc: {
  edits: StagedCells<string | number>;
}): Record<string, StagedRoomEdit> {
  const edits = new Map<string, StagedRoomEdit>();
  for (const [key, value] of stagedOf(doc.edits)) {
    const { roomId, field } = takeoffEditAddress(key);
    if (!roomEditSchema.shape[field].safeParse(value).success)
      throw Error(`Invalid Takeoffs room edit for ${field}`);
    const edit = edits.get(roomId) ?? { roomId, next: {} };
    (edit.next as Record<string, unknown>)[field] = value;
    edits.set(roomId, edit);
  }
  return Object.fromEntries(edits);
}
export const stagedAdoptChoices = <V>(doc: { adopt: StagedCells<V> }) =>
  Object.fromEntries(stagedOf(doc.adopt));
/** Current flag verdict edits, keyed by `takeoffDecisionKey`. */
export const stagedDecisions = (doc: { decisions: StagedCells<"accept" | "dismiss"> }) =>
  Object.fromEntries(stagedOf(doc.decisions));
