/**
 * Takeoff Page schemas and pure model projections shared by graph adapters and seed data.
 */
import { z } from "zod";
import {
  routeAddress,
  documentRefSchema,
  workKeySchema,
  type TakeoffModel,
  type TakeoffSnapshot,
  type StagedRoomEdit,
  type ModelRoom,
  type ModelZone,
  type Reading,
  type TakeoffObservation,
} from "@pe/agent-contracts";
import { takeoffDecisionKey } from "@pe/agent-contracts";

import { applyEdit } from "./world";

const syncReviewSchema = z.object({
  target: documentRefSchema,
  work: z.object({ key: workKeySchema, revision: z.number() }),
  captureId: z.string(),
  fileVersion: z.string(),
  path: z.string(),
  zones: z.array(z.string()).readonly(),
});

/**
 * Route-lifetime action scope. `views`/`zones`/`r10`/`stage` select what route actions mean;
 * target changes reset them. `panel` and `syncReview` are
 * short-lived review state and every scope transition invalidates them. Standalone room navigation
 * lives in its URL, embedded navigation in its controller, and authored decisions in Work.
 */
export const takeoffPageSchema = routeAddress("takeoffs").schema.extend({
  work: z.string().optional(),
  views: z.array(z.string()).readonly().default([]),
  zones: z.array(z.string()).readonly().default([]),
  r10: z.string().default(""),
  stage: z.enum(["adopt", "audit", "sync"]).default("adopt"),
  panel: z.enum(["sync"]).nullable().default(null),
  syncReview: syncReviewSchema.nullable().default(null),
});
export type TakeoffPage = z.infer<typeof takeoffPageSchema>;

export type TakeoffReadingKey = "snapshot" | "rhvacVersion" | "inventory" | "receipts";

export const snapshotOfObservation = (
  observation: TakeoffObservation | undefined,
): TakeoffSnapshot | undefined =>
  observation?.kind === "ready"
    ? observation.capture.snapshot
    : observation?.kind === "reading" || observation?.kind === "failed"
      ? observation.previous?.snapshot
      : undefined;
const takeoffHealth = (snapshot: TakeoffSnapshot | undefined): string | null =>
  snapshot?.carriers.status === "needs-initialization"
    ? `needs initialization · ${snapshot.carriers.missingCarrierGuids.length} carriers`
    : null;
export const takeoffReadingHealth = (reading: Reading<TakeoffSnapshot>): string | null =>
  reading.state === "failed"
    ? reading.message
    : reading.state === "ready"
      ? takeoffHealth(reading.observation)
      : null;
export interface SyncPlan {
  readonly linkedUpdates: number;
  readonly inScope: readonly ModelZone[];
  readonly blockedZones: readonly ModelZone[];
  readonly inserts: readonly { readonly zone: ModelZone; readonly room: ModelRoom }[];
  readonly untagged: number;
  readonly tags: readonly string[];
}

export function syncPlan(
  world: TakeoffModel,
  selectedZones: readonly string[],
  edit: Readonly<Record<string, StagedRoomEdit>> = {},
  decisions: Readonly<Record<string, "accept" | "dismiss">> = {},
): SyncPlan {
  const selected = new Set(selectedZones);
  const inScope = world.zones
    .filter((zone) => selected.size === 0 || selected.has(zone.zone.guid))
    .map((zone) => ({
      ...zone,
      rooms: zone.rooms.map((room) => applyEdit(room, edit[room.guid]?.next)),
    }));
  const blockedZones = inScope.filter(
    (zone) =>
      zone.driftSqft === null ||
      zone.driftSqft > 0 ||
      zone.rooms.some(
        (room) => room.analysis?.state !== "current" || room.analysis.hold !== null,
      ) ||
      zone.rooms.some((room) =>
        room.flags.some((flag) => decisions[takeoffDecisionKey(room.guid, flag)] === undefined),
      ) ||
      zone.runs.some((run) => run.orphaned > 0 || run.failures > 0),
  );
  const blocked = new Set(blockedZones.map((zone) => zone.zone.guid));
  const inserts = inScope.flatMap((zone) =>
    blocked.has(zone.zone.guid)
      ? []
      : zone.rooms
          .filter((room) => room.elementId !== null && room.r10 === null && room.data !== null)
          .map((room) => ({ zone, room })),
  );
  return {
    inScope,
    linkedUpdates: inScope
      .flatMap((zone) => zone.rooms)
      .filter((room) => room.r10 && edit[room.guid]).length,
    blockedZones,
    inserts,
    untagged: inserts.filter(({ zone }) => zone.tags.length === 0).length,
    tags: [...new Set(inserts.flatMap(({ zone }) => zone.tags))],
  };
}
