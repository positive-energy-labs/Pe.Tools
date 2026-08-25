import { z } from "zod";

import { defineRouteState, routeBindingSchema } from "./route-state.ts";

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

const worldLaneSchema = z.object({
  view: z.string(),
  label: z.string(),
  replayPath: z.string().nullable(),
});

const worldRoomSchema = z.object({
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
  data: z
    .object({
      people: z.number(),
      lightingW: z.number(),
      equipSensible: z.number(),
      equipLatent: z.number(),
      ventilationCfm: z.number(),
    })
    .nullable(),
  outer: z.array(pointSchema).nullable(),
  holes: z.array(z.array(pointSchema)),
});

const worldZoneSchema = z.object({
  zone: z.object({
    guid: z.string(),
    elementId: z.number().nullable(),
    key: z.string(),
    ordinal: z.number(),
    lane: worldLaneSchema,
    color: z.string(),
    loops: worldLoopsSchema,
    declaredSqft: z.number(),
    bounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }),
  }),
  stage: z.enum(["declared", "registered", "partitioned", "reviewed", "data", "synced", "drifted"]),
  tags: z.array(z.string()),
  name: z.string(),
  rooms: z.array(worldRoomSchema),
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
  driftSqft: z.number(),
});

const candidateRegionSchema = z.object({
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

const liveRegionSchema = z.object({
  elementId: z.number(),
  role: z.string(),
  guid: z.string(),
  sqft: z.number(),
  roomType: z.string().optional(),
  blob: z.string(),
  outer: z.array(pointSchema),
});

export const takeoffSnapshotSchema = z.object({
  world: z.object({
    docName: z.string(),
    r10Path: z.string().nullable(),
    lanes: z.array(worldLaneSchema),
    zones: z.array(worldZoneSchema),
    systems: z.array(
      z.object({
        guid: z.string(),
        tag: z.string(),
        zoneKeys: z.array(z.string()),
        sensibleBtuh: z.number(),
        overCap: z.boolean(),
      }),
    ),
  }),
  status: z
    .object({
      doc: z.string(),
      systems: z.array(z.object({ guid: z.string(), tag: z.string() })),
      regions: z.array(z.object({ zoneGuid: z.string(), rooms: z.number(), held: z.number() })),
    })
    .optional(),
  views: z.array(z.object({ name: z.string(), level: z.string(), regions: z.number() })),
  zoneFrs: z.array(candidateRegionSchema),
  regionsByZone: z.record(z.string(), z.array(liveRegionSchema)),
});
export type TakeoffSnapshot = z.infer<typeof takeoffSnapshotSchema>;

export const stagedRoomEditSchema = z.object({
  roomId: z.string(),
  base: roomEditSchema,
  next: roomEditSchema,
});
export type StagedRoomEdit = z.infer<typeof stagedRoomEditSchema>;

export const takeoffsDocumentSchema = z.object({
  binding: routeBindingSchema,
  snapshot: takeoffSnapshotSchema.nullable().default(null),
  staged: z.array(stagedRoomEditSchema).default([]),
});
export type TakeoffsRouteDocument = z.infer<typeof takeoffsDocumentSchema>;

const selectionSchema = z.object({
  view: z.string(),
  zones: z.array(z.string()),
});

export const takeoffsRouteState = defineRouteState({
  route: "takeoffs",
  title: "Takeoffs",
  description: "Adopt zoning regions, audit rooms, and sync reviewed takeoff data.",
  schema: takeoffsDocumentSchema,
  agentWriteMask: [["staged", "*"]],
  commands: {
    adopt: {
      description: "Adopt the selected zoning regions from a view.",
      input: selectionSchema,
      actor: "any",
    },
    audit: {
      description: "Capture the selected view and partition the selected zones.",
      input: selectionSchema,
      actor: "any",
    },
    sync: {
      description: "HUMAN ONLY. Commit eligible staged rooms to the bound .r10.",
      input: selectionSchema.extend({ commit: z.literal(true) }),
      actor: "human",
      mutatesExternal: true,
    },
  },
});
