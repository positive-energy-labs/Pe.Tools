import type { TakeoffModel, ModelRoom, ModelZone } from "@pe/agent-contracts";

import type { GeoRoom, GeoZone } from "./mock-geo";
import type { MockRoom, MockModel, MockZone } from "./mock";

const room = (r: GeoRoom | MockRoom): ModelRoom => ({
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
  r10: r.r10 ? { fileIdentity: "seed", ...r.r10 } : null,
  data: r.data,
  outer: "outer" in r ? r.outer : null,
  holes: "holes" in r ? r.holes : [],
});

const zone = (z: GeoZone | MockZone): ModelZone => ({
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
  residues: ("residues" in z ? z.residues : []).map((r) => ({
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

export const projectFixtureModel = (fixture: MockModel): TakeoffModel => ({
  docName: fixture.docName,
  r10Path: fixture.r10Path,
  lanes: [...new Map(fixture.zones.map((z) => [z.zone.lane.view, z.zone.lane])).values()].map(
    (lane) => ({ view: lane.view, label: lane.label, replayPath: null }),
  ),
  zones: fixture.zones.map(zone),
  systems: fixture.systems.map((system) => ({
    guid: system.guid,
    tag: system.tag,
    zoneKeys: system.zoneKeys,
    sensibleBtuh: system.sensibleBtuh,
    overCap: system.overCap,
  })),
});
