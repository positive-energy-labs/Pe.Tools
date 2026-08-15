/**
 * FIXTURE ADAPTER — the project-a mock world projected into the live `World` vocabulary.
 *
 * Explicitly chosen (`/takeoffs?source=fixture`), never a fallback: it exists so the atlas is
 * exercisable with dense mid-project state and no Revit attached. Everything here is synthetic
 * or replayed project-a data; elementIds are null, so every write path is inert by construction.
 */
import { useMemo } from "react";

import type { World, WorldRoom, WorldZone } from "#/takeoff/world";

import { useMockWorldGeo, type GeoRoom, type GeoZone } from "./mock-geo";

const room = (r: GeoRoom): WorldRoom => ({
  guid: r.guid,
  elementId: null,
  name: r.name,
  type: r.type,
  sqft: r.sqft,
  ceilingFt: r.ceilingFt,
  label: r.label,
  flags: r.flags.filter((f) => !r.decisions.some((d) => d.flag === f)),
  decisions: r.decisions.map((d) => ({ subject: r.guid, ...d })),
  provenance: { ...r.provenance, sourceRoomId: r.guid },
  r10: r.r10 ? { fileIdentity: "fixture", ...r.r10 } : null,
  data: r.data,
  outer: r.outer,
  holes: r.holes,
});

const zone = (z: GeoZone): WorldZone => ({
  zone: {
    guid: z.zone.guid,
    elementId: null,
    key: z.zone.key,
    ordinal: z.zone.ordinal,
    lane: { view: z.zone.lane.view, label: z.zone.lane.label, replayPath: null },
    color: z.zone.color,
    loops: z.zone.loops,
    declaredSqft: z.zone.declaredSqft,
    bounds: z.zone.bounds,
  },
  stage: z.stage,
  tags: z.tags,
  name: z.name,
  rooms: z.rooms.map(room),
  residues: z.residues.map((r) => ({
    id: r.id,
    reason: r.reason,
    rawSqft: r.rawSqft,
    label: r.label,
    outer: r.outer,
    holes: r.holes,
  })),
  heldSqft: z.heldSqft,
  runs: z.runs.map((r) => ({
    runId: r.runId,
    created: r.created,
    rebound: r.rebound,
    held: r.held,
    orphaned: r.orphaned,
    failures: 0,
    declaredSqft: r.declaredSqft,
    roomSqft: r.roomSqft,
    claimedWallSqft: r.claimedWallSqft,
    excludedSqft: r.excludedSqft,
  })),
  driftSqft: z.driftSqft,
});

export function useFixtureWorld(): { world: World; geoReady: boolean } {
  const { world: geo, geoReady } = useMockWorldGeo();
  const world = useMemo<World>(
    () => ({
      docName: geo.docName,
      r10Path: geo.r10Path,
      lanes: [...new Map(geo.zones.map((z) => [z.zone.lane.view, z.zone.lane])).values()].map(
        (lane) => ({ view: lane.view, label: lane.label, replayPath: null }),
      ),
      zones: geo.zones.map(zone),
      systems: geo.systems.map((s) => ({
        guid: s.guid,
        tag: s.tag,
        zoneKeys: s.zoneKeys,
        sensibleBtuh: s.sensibleBtuh,
        overCap: s.overCap,
      })),
    }),
    [geo],
  );
  return { world, geoReady };
}
