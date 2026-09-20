import { z } from "zod";

import { type RouteStatePatch, type RouteStateSpec } from "./route-state.ts";
import { transitionPatches, trichotomyCellSchema, type TrichotomyCellLike } from "./trichotomy.ts";
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

/** Immutable host-owned observation. */
export const takeoffCaptureSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.object({ kind: z.literal("live"), target: documentRefSchema }),
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

/** A room's staged edit as the host consumes it: the baseline beside, the staged values as `next`. */
export const stagedRoomEditSchema = z.object({
  roomId: z.string(),
  base: roomEditSchema,
  next: roomEditSchema,
});
export type StagedRoomEdit = z.infer<typeof stagedRoomEditSchema>;
export type RoomEdit = z.infer<typeof roomEditSchema>;
export type RoomEditField = keyof RoomEdit;
const ROOM_EDIT_FIELDS = Object.keys(roomEditSchema.shape) as RoomEditField[];

/** One canonical JSON tuple per cell address, the Families encoding rule. */
const tupleKey = (parts: readonly string[]) => JSON.stringify(parts);
const tupleOf = (key: string, length: number): string[] | null => {
  try {
    const parts = JSON.parse(key) as unknown;
    return Array.isArray(parts) &&
      parts.length === length &&
      parts.every((part) => typeof part === "string") &&
      tupleKey(parts) === key
      ? parts
      : null;
  } catch {
    return null;
  }
};
const keyed = (length: number, what: string) =>
  z.string().refine((key) => tupleOf(key, length) !== null, {
    error: `a takeoffs ${what} cell key must be a canonical JSON tuple`,
  });

/** A room field's edit: `[roomId, field]`, its value that field's next value. */
export const takeoffEditKey = (roomId: string, field: RoomEditField) => tupleKey([roomId, field]);
export const takeoffEditAddress = (key: string) => {
  const [roomId, field] = tupleOf(key, 2)!;
  return { roomId: roomId!, field: field as RoomEditField };
};
/** A person's verdict on a solver flag: `[roomGuid, flag]`. */
export const takeoffDecisionKey = (roomGuid: string, flag: string) => tupleKey([roomGuid, flag]);
export const takeoffDecisionAddress = (key: string) => {
  const [roomGuid, flag] = tupleOf(key, 2)!;
  return { roomGuid: roomGuid!, flag: flag! };
};
/** A review flag on one shape of a zone's saved partition review: `[zoneKey, shapeKey]`. */
export const takeoffFlagKey = (zoneKey: string, shapeKey: string) => tupleKey([zoneKey, shapeKey]);

const editCellSchema = trichotomyCellSchema(z.union([z.string(), z.number()]));
const adoptChoiceSchema = z.object({
  checked: z.boolean().optional(),
  name: z.string().optional(),
  systemTag: z.string().optional(),
});
export type AdoptChoice = z.infer<typeof adoptChoiceSchema>;
const verdictSchema = z.enum(["accept", "dismiss"]);

/**
 * Every authored takeoff judgment is a cell (co-sign rules 1-3): Pea proposes, a person stages,
 * and hosts read `staged` only. `bases` holds each edited room's immutable baseline beside the
 * cells, never inside a value. Strict, so pre-cells Work fails closed rather than lose its values.
 */
const takeoffsDocumentSchema = z
  .strictObject({
    edits: z.record(keyed(2, "edit"), editCellSchema).default({}),
    bases: z.record(z.string(), roomEditSchema).default({}),
    /** Keyed by candidate (`<view>:<elementId>`). */
    adopt: z.record(z.string(), trichotomyCellSchema(adoptChoiceSchema)).default({}),
    decisions: z.record(keyed(2, "decision"), trichotomyCellSchema(verdictSchema)).default({}),
    /** A flag has no commit verb: the staged set is the durable judgment and the export. */
    reviewFlags: z
      .record(keyed(2, "review flag"), trichotomyCellSchema(z.literal(true)))
      .default({}),
  })
  .superRefine((doc, ctx) => {
    // Each edit's rungs hold a value that field accepts.
    for (const [key, cell] of Object.entries(doc.edits)) {
      const { field } = takeoffEditAddress(key);
      const schema = (roomEditSchema.shape as Record<string, z.ZodOptional<z.ZodType>>)[field];
      if (!schema) {
        ctx.addIssue({ code: "custom", path: ["edits", key], message: `no room field '${field}'` });
        continue;
      }
      for (const rung of ["proposal", "staged"] as const) {
        const value = cell[rung]?.value;
        if (value !== undefined && !schema.unwrap().safeParse(value).success)
          ctx.addIssue({
            code: "custom",
            path: ["edits", key, rung, "value"],
            message: `not a ${field} value`,
          });
      }
    }
  });
export type TakeoffsRouteDocument = z.infer<typeof takeoffsDocumentSchema>;

const stagedOf = <V>(cells: Record<string, TrichotomyCellLike>) =>
  Object.entries(cells).flatMap(([key, cell]) =>
    cell.staged?.value !== undefined ? [[key, cell.staged.value as V] as const] : [],
  );

/** The person's staged room edits, one per room: what sync consumes. Proposals never appear. */
export function stagedTakeoffEdits(doc: TakeoffsRouteDocument): Record<string, StagedRoomEdit> {
  const rooms: Record<string, StagedRoomEdit> = {};
  for (const [key, value] of stagedOf<string | number>(doc.edits)) {
    const { roomId, field } = takeoffEditAddress(key);
    const edit = (rooms[roomId] ??= { roomId, base: doc.bases[roomId] ?? {}, next: {} });
    (edit.next as Record<string, unknown>)[field] = value;
  }
  return rooms;
}
export const stagedAdoptChoices = (doc: TakeoffsRouteDocument): Record<string, AdoptChoice> =>
  Object.fromEntries(stagedOf<AdoptChoice>(doc.adopt));
/** The person's staged flag verdicts, keyed by `takeoffDecisionKey`. */
export const stagedDecisions = (doc: TakeoffsRouteDocument): Record<string, "accept" | "dismiss"> =>
  Object.fromEntries(stagedOf<"accept" | "dismiss">(doc.decisions));
/** The person's staged review flags per zone. */
export function stagedReviewFlags(doc: TakeoffsRouteDocument): Record<string, string[]> {
  const zones: Record<string, string[]> = {};
  for (const [key] of stagedOf<true>(doc.reviewFlags)) {
    const [zoneKey, shapeKey] = tupleOf(key, 2)!;
    (zones[zoneKey!] ??= []).push(shapeKey!);
  }
  return zones;
}

/** A person discards every staged room edit: each staged edit cell unstages; proposals stay. */
export const takeoffDiscardEdits = (doc: TakeoffsRouteDocument): RouteStatePatch[] =>
  Object.entries(doc.edits).flatMap(([key, cell]) =>
    cell.staged ? transitionPatches(["edits"], key, cell, { kind: "unstage" }) : [],
  );

/** A person flags a review shape, or unflags it: unflag unstages the shape's cell. */
export function takeoffFlagToggle(
  doc: TakeoffsRouteDocument,
  zoneKey: string,
  shapeKey: string,
): RouteStatePatch[] {
  const key = takeoffFlagKey(zoneKey, shapeKey);
  const cell = doc.reviewFlags[key] ?? {};
  return transitionPatches(
    ["reviewFlags"],
    key,
    cell,
    cell.staged ? { kind: "unstage" } : { kind: "stage", rung: { value: true } },
  );
}

/**
 * A person stages a room's next values: each field stages against the room's baseline (equal to
 * the baseline stages nothing), and a field the edit no longer carries unstages. The baseline is
 * recorded beside the cells the first time the room is edited.
 */
export function takeoffEditPatches(
  doc: TakeoffsRouteDocument,
  roomId: string,
  base: RoomEdit,
  next: RoomEdit,
): RouteStatePatch[] {
  const baseline = doc.bases[roomId] ?? base;
  return [
    ...(doc.bases[roomId] ? [] : [{ path: ["bases", roomId], value: base }]),
    ...ROOM_EDIT_FIELDS.flatMap((field) => {
      const key = takeoffEditKey(roomId, field);
      const cell = doc.edits[key] ?? {};
      const value = next[field];
      if (value === undefined)
        return cell.staged ? transitionPatches(["edits"], key, cell, { kind: "unstage" }) : [];
      return transitionPatches(["edits"], key, cell, {
        kind: "stage",
        rung: { value },
        ...(baseline[field] === undefined ? {} : { baseline: { value: baseline[field] } }),
      });
    }),
  ];
}

export const takeoffsRouteState = {
  route: "takeoffs",
  title: "Takeoffs",
  description:
    "A person's staged room values, adoption choices, flag verdicts and review flags, each one cell. Pea may propose on any of them; a person stages, and sync reads staged values only. Model geometry is read from takeoffs.snapshot; durable saved observations are at /takeoffs/observations.",
  schema: takeoffsDocumentSchema,
  // Pea proposes; staged values and room baselines are a person's.
  agentWriteMask: [
    ["edits", "*", "proposal"],
    ["adopt", "*", "proposal"],
    ["decisions", "*", "proposal"],
    ["reviewFlags", "*", "proposal"],
  ],
  commands: {},
} satisfies RouteStateSpec<typeof takeoffsDocumentSchema>;
