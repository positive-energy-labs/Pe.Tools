/**
 * The takeoff world — the one render vocabulary the /takeoffs route draws.
 *
 * Two providers build it: the LIVE lane (scripting reads against the targeted document, plus a
 * session overlay of this tab's partition runs and pending edits) and the FIXTURE adapter
 * (project-a mock, explicitly chosen, never a fallback). Authority stays where it lives — zone
 * geometry on the Zoning Region FR, identity on the stamps, decisions on the Room Region blob,
 * Manual J data in the `.r10`. This module only joins those reads for rendering.
 */
import {
  containsEvenOdd,
  loopBounds,
  shoelace,
  type CandidateRegion,
  type DetectedResidue,
  type LiveRegion,
  type ModelStatus,
  type PartitionRun,
  type Resolution,
  type ViewFacts,
} from "#/takeoff/model";
import type { Bounds2 } from "#/lib/affine-frame";
import type { RhvacExtractData, RhvacRoomData } from "@pe/host-contracts/operation-types";

// ── Stage vocabulary (was mock-only; now derived from live facts) ───────────

export type Stage =
  | "declared" // adopted, no system tag typed
  | "registered" // tag resolved against the registry
  | "partitioned" // rooms materialized, decisions open
  | "reviewed" // decision queue empty
  | "data" // Manual J data entered, not yet exported
  | "synced" // .r10 in sync
  | "drifted"; // hand-edit drift against accepted state since last sync

export const STAGE_ORDER: Stage[] = [
  "declared",
  "registered",
  "partitioned",
  "reviewed",
  "data",
  "synced",
  "drifted",
];

export type RoomType =
  | "bedroom"
  | "primary bedroom"
  | "full bath"
  | "powder"
  | "kitchen"
  | "dining"
  | "office"
  | "laundry"
  | "great room"
  | "exercise"
  | "mechanical"
  | "hall";

/** Firm law: sensible ≤ 32,000 Btu/hr per zone/system (equipment constraint). */
export const SENSIBLE_CAP_BTUH = 32_000;

export interface RoomData {
  people: number;
  lightingW: number;
  equipSensible: number;
  equipLatent: number;
  ventilationCfm: number;
}

// ── World shapes ────────────────────────────────────────────────────────────

export interface WorldLane {
  /** Zoning view the zones were adopted on. */
  view: string;
  /** Level name (from the view's GenLevel) — the board's grouping label. */
  label: string;
  /** replay_<level>.bin path once this session captured the level; null before. */
  replayPath: string | null;
}

export interface WorldZoneIdentity {
  guid: string;
  /** Stamped Zoning Region element — the adoption home. Null only in the fixture. */
  elementId: number | null;
  key: string;
  ordinal: number;
  lane: WorldLane;
  color: string;
  loops: readonly (readonly (readonly [number, number])[])[];
  declaredSqft: number;
  bounds: Bounds2;
}

export interface WorldRoom {
  /** Stamped Room Region identity — stable across reruns via geometric rebind. */
  guid: string;
  /** Room Region FR element — the decision write-through home. Null = no home yet. */
  elementId: number | null;
  name: string;
  type: RoomType;
  sqft: number;
  ceilingFt: number;
  label: [number, number];
  /** Open detector flags — session-only: this run's flags, minus written decisions. */
  flags: string[];
  decisions: Resolution[];
  provenance: { runId: string; sourceRoomId: string; sourceSqft: number };
  r10: {
    identifier: number;
    fileIdentity: string;
    syncedAt: string;
    lastSyncedSqft: number;
  } | null;
  data: RoomData | null;
  outer: [number, number][] | null;
  holes: [number, number][][];
}

export interface WorldResidue {
  id: string;
  reason: string;
  rawSqft: number;
  label: [number, number];
  outer: [number, number][];
  holes: [number, number][][];
}

export interface WorldRun {
  runId: string;
  created: number;
  rebound: number;
  held: number;
  orphaned: number;
  failures: number;
  declaredSqft: number;
  roomSqft: number;
  claimedWallSqft: number;
  excludedSqft: number;
}

export interface WorldZone {
  zone: WorldZoneIdentity;
  stage: Stage;
  tags: string[];
  name: string;
  rooms: WorldRoom[];
  residues: WorldResidue[];
  heldSqft: number;
  runs: WorldRun[];
  driftSqft: number;
}

export interface WorldSystem {
  guid: string;
  tag: string;
  zoneKeys: string[];
  sensibleBtuh: number;
  overCap: boolean;
}

export interface World {
  docName: string;
  r10Path: string | null;
  lanes: WorldLane[];
  zones: WorldZone[];
  systems: WorldSystem[];
}

// ── Session overlay — this tab's ephemeral state, by design ─────────────────
//
// Pending partition runs and Manual J edits live here until their real homes take them: a
// decision write-through moves a call onto the Room Region blob; a sync moves the data into
// the .r10. seam: pre-sync Manual J entry dies with the tab — a draft home (blob extension or
// .r10 working copy) is an open design question, deliberately not solved here.

export interface RoomEdit {
  name?: string;
  type?: RoomType;
  ceilingFt?: number;
  people?: number;
  lightingW?: number;
  equipSensible?: number;
  equipLatent?: number;
  ventilationCfm?: number;
}

export interface SessionOverlay {
  /** zoneGuid → latest partition run this session executed. */
  runs: Record<string, PartitionRun>;
  /** replay path per level label, from this session's captures. */
  replays: Record<string, string>;
  /** room guid → pending Manual J / naming edits (session-ephemeral until sync). */
  edits: Record<string, RoomEdit>;
}

export const emptyOverlay = (): SessionOverlay => ({ runs: {}, replays: {}, edits: {} });

// ── Blob extensions (the dumb-pipe splices the codec tolerates) ─────────────

interface BlobExt {
  runId: string;
  sourceRoomId: string;
  sourceSqft: number;
  resolutions: Resolution[];
  r10: WorldRoom["r10"];
  flags: string[];
}

export function readBlobExt(blob: string): BlobExt {
  const parsed = JSON.parse(blob) as {
    RunId?: string;
    runId?: string;
    SourceRoomId?: string;
    sourceRoomId?: string;
    SourceSqft?: number;
    sourceSqft?: number;
    resolutions?: Resolution[];
    r10?: WorldRoom["r10"];
    flags?: string[];
  };
  const runId = parsed.RunId ?? parsed.runId;
  const sourceRoomId = parsed.SourceRoomId ?? parsed.sourceRoomId;
  const sourceSqft = parsed.SourceSqft ?? parsed.sourceSqft;
  if (!runId || !sourceRoomId || typeof sourceSqft !== "number")
    throw new Error("Room Region provenance is missing runId, sourceRoomId, or sourceSqft");
  return {
    runId,
    sourceRoomId,
    sourceSqft,
    resolutions: Array.isArray(parsed.resolutions) ? parsed.resolutions : [],
    r10: parsed.r10 ?? null,
    flags: Array.isArray(parsed.flags) ? parsed.flags : [],
  };
}

/** Zone-FR provenance meta written at adoption ({v, view, name, systemTag}). */
export function readZoneMeta(blob: string): { view: string; name: string; systemTag: string } {
  const parsed = JSON.parse(blob) as { view?: string; name?: string; systemTag?: string };
  if (!parsed.view || !parsed.name)
    throw new Error("Zoning Region provenance is missing view or name");
  return { view: parsed.view, name: parsed.name, systemTag: parsed.systemTag ?? "" };
}

// ── Live world assembly ─────────────────────────────────────────────────────

export const centroid = (loop: readonly (readonly [number, number])[]): [number, number] => {
  let x = 0;
  let y = 0;
  for (const [px, py] of loop) {
    x += px;
    y += py;
  }
  const n = Math.max(loop.length, 1);
  return [x / n, y / n];
};

export const applyEdit = (room: WorldRoom, edit: RoomEdit | undefined): WorldRoom => {
  if (!edit) return room;
  const hasData =
    edit.people !== undefined ||
    edit.lightingW !== undefined ||
    edit.equipSensible !== undefined ||
    edit.equipLatent !== undefined ||
    edit.ventilationCfm !== undefined;
  const base = room.data ?? {
    people: 0,
    lightingW: 0,
    equipSensible: 0,
    equipLatent: 0,
    ventilationCfm: 0,
  };
  return {
    ...room,
    name: edit.name ?? room.name,
    type: edit.type ?? room.type,
    ceilingFt: edit.ceilingFt ?? room.ceilingFt,
    data: hasData
      ? {
          people: edit.people ?? base.people,
          lightingW: edit.lightingW ?? base.lightingW,
          equipSensible: edit.equipSensible ?? base.equipSensible,
          equipLatent: edit.equipLatent ?? base.equipLatent,
          ventilationCfm: edit.ventilationCfm ?? base.ventilationCfm,
        }
      : room.data,
  };
};

function roomsOf(
  regions: LiveRegion[],
  run: PartitionRun | undefined,
  overlay: SessionOverlay,
  r10Rooms: ReadonlyMap<number, RhvacRoomData>,
  r10FileIdentity: string | null,
): { rooms: WorldRoom[]; residues: WorldResidue[] } {
  const rooms: WorldRoom[] = [];
  const residues: WorldResidue[] = [];
  const claimed = new Set<number>();

  // This session's run supplies flags and fresh geometry; regions supply identity + decisions.
  if (run) {
    for (const detected of run.rooms) {
      const region = run.regions.find(
        (r) =>
          r.role === "room-region" &&
          containsEvenOdd([r.outer], detected.label[0], detected.label[1]),
      );
      if (region) claimed.add(region.elementId);
      const ext = region ? readBlobExt(region.blob) : null;
      const decisions = ext?.resolutions ?? [];
      const fileMismatch = Boolean(
        ext?.r10 && r10FileIdentity && ext.r10.fileIdentity !== r10FileIdentity,
      );
      const fileNotOpen = Boolean(ext?.r10 && !r10FileIdentity);
      const synced = ext?.r10 && !fileMismatch ? r10Rooms.get(ext.r10.identifier) : undefined;
      rooms.push(
        applyEdit(
          {
            guid: region?.guid ?? `undetached:${detected.id}`,
            elementId: region?.elementId ?? null,
            name: synced?.name ?? detected.id,
            type: (region?.roomType || "hall") as RoomType,
            sqft: Math.round(detected.rawSqft),
            ceilingFt: Math.round(detected.meanCeilingFt * 2) / 2,
            label: detected.label,
            flags: [
              // A detected room with no materialized region is an un-homed proposal: first-run
              // rooms all bind to their created FR, so this only fires on a rerun that found a NEW
              // room (or a first-run create that failed). It blocks sync and shows a call rather
              // than letting a confident room silently escape — "zero silent drops" (README).
              // ponytail: blocks today; the accept→materialize verb (C# MaterializeAccepted) is the
              // next slice that makes the call clearable instead of only stopping the sync.
              ...(region ? [] : ["unhomed-proposal"]),
              ...detected.flags.filter(
                (f) =>
                  !decisions.some(
                    (d) => d.subject === (ext?.sourceRoomId ?? detected.id) && d.flag === f,
                  ),
              ),
              ...(fileMismatch ? ["r10-file-mismatch"] : []),
              ...(fileNotOpen ? ["r10-not-open"] : []),
            ],
            decisions,
            provenance: {
              runId: ext?.runId ?? "",
              sourceRoomId: ext?.sourceRoomId ?? detected.id,
              sourceSqft: detected.rawSqft,
            },
            r10: ext?.r10 ?? null,
            data: synced ? roomData(synced) : null,
            outer: detected.outer,
            holes: [],
          },
          overlay.edits[region?.guid ?? `undetached:${detected.id}`],
        ),
      );
    }
  }

  // Regions this run didn't claim (or with no run at all): identity + blob, geometry from the FR.
  for (const region of regions) {
    if (region.role === "held-residue") continue;
    if (claimed.has(region.elementId)) continue;
    const ext = readBlobExt(region.blob);
    const fileMismatch = Boolean(
      ext.r10 && r10FileIdentity && ext.r10.fileIdentity !== r10FileIdentity,
    );
    const fileNotOpen = Boolean(ext.r10 && !r10FileIdentity);
    const synced = ext.r10 && !fileMismatch ? r10Rooms.get(ext.r10.identifier) : undefined;
    rooms.push(
      applyEdit(
        {
          guid: region.guid,
          elementId: region.elementId,
          name: synced?.name ?? ext.sourceRoomId,
          type: (region.roomType || "hall") as RoomType,
          sqft: Math.round(region.sqft),
          ceilingFt: synced?.ceilingHeightFeet ?? 0,
          label: centroid(region.outer),
          flags: [
            ...ext.flags.filter(
              (flag) =>
                !ext.resolutions.some((d) => d.subject === ext.sourceRoomId && d.flag === flag),
            ),
            ...(run ? ["orphaned-region"] : []),
            ...(fileMismatch ? ["r10-file-mismatch"] : []),
            ...(fileNotOpen ? ["r10-not-open"] : []),
          ],
          decisions: ext.resolutions,
          provenance: {
            runId: ext.runId,
            sourceRoomId: ext.sourceRoomId,
            sourceSqft: ext.sourceSqft,
          },
          r10: ext.r10,
          data: synced ? roomData(synced) : null,
          outer: region.outer,
          holes: [],
        },
        overlay.edits[region.guid],
      ),
    );
  }

  const residueSource: (DetectedResidue | LiveRegion)[] = run
    ? run.residues
    : regions.filter((r) => r.role === "held-residue");
  for (const r of residueSource) {
    const isDetected = "reason" in r;
    residues.push({
      id: isDetected ? r.id : r.guid,
      reason: isDetected ? r.reason : "held",
      rawSqft: isDetected ? r.rawSqft : r.sqft,
      label: isDetected ? r.label : centroid(r.outer),
      outer: r.outer,
      holes: [],
    });
  }

  return { rooms, residues };
}

const roomData = (room: RhvacRoomData): RoomData => ({
  people: room.people,
  lightingW: room.lightingWatts,
  equipSensible: room.equipmentSensibleBtuh,
  equipLatent: room.equipmentLatentBtuh,
  ventilationCfm: room.ventilationCfm,
});

function stageOf(zone: Omit<WorldZone, "stage">): Stage {
  if (zone.driftSqft > 0) return "drifted";
  if (zone.rooms.length === 0) return zone.tags.length > 0 ? "registered" : "declared";
  if (zone.rooms.some((r) => r.flags.length > 0)) return "partitioned";
  if (zone.rooms.every((r) => r.r10 !== null)) return "synced";
  if (zone.rooms.every((r) => r.data !== null)) return "data";
  return "reviewed";
}

/**
 * Assemble the live world from the raw reads + this session's overlay. Pure — the route owns
 * when to re-read; the atlas just renders the result.
 */
export function buildLiveWorld(raw: {
  status: ModelStatus;
  zoneFrs: CandidateRegion[];
  views: ViewFacts[];
  regionsByZone: Record<string, LiveRegion[]>;
  overlay: SessionOverlay;
  r10Path: string | null;
  r10: RhvacExtractData | null;
}): World {
  const { status, zoneFrs, views, regionsByZone, overlay } = raw;
  const levelByView = new Map(views.map((v) => [v.name, v.level]));
  const lanes: WorldLane[] = [];
  const laneFor = (view: string): WorldLane => {
    const label = levelByView.get(view) || view;
    let lane = lanes.find((l) => l.view === view);
    if (!lane) {
      lane = { view, label, replayPath: overlay.replays[label] ?? null };
      lanes.push(lane);
    }
    return lane;
  };

  const ordinals = new Map<string, number>();
  const r10Rooms = new Map((raw.r10?.rooms ?? []).map((room) => [room.identifier, room]));
  const r10FileIdentity = raw.r10
    ? `${raw.r10.fileIdentity.fileName}#${raw.r10.fileIdentity.stamp}`
    : null;
  const zones: WorldZone[] = zoneFrs.map((fr) => {
    const meta = readZoneMeta(fr.blob);
    const lane = laneFor(fr.view || meta.view);
    const ordinal = (ordinals.get(lane.view) ?? 0) + 1;
    ordinals.set(lane.view, ordinal);
    const loops = fr.loops;
    const identity: WorldZoneIdentity = {
      guid: fr.guid ?? "",
      elementId: fr.elementId,
      key: `${lane.label}#${String(ordinal).padStart(2, "0")}`,
      ordinal,
      lane,
      color: fr.color,
      loops,
      declaredSqft: loops.reduce((sum, loop) => sum + shoelace(loop), 0),
      bounds: loopBounds(loops),
    };
    const run = overlay.runs[identity.guid];
    const { rooms, residues } = roomsOf(
      regionsByZone[identity.guid] ?? [],
      run,
      overlay,
      r10Rooms,
      r10FileIdentity,
    );
    const driftSqft = rooms.reduce(
      (sum, r) => sum + (r.r10 ? Math.abs(r.sqft - r.r10.lastSyncedSqft) : 0),
      0,
    );
    const heldSqft = residues.reduce((sum, r) => sum + r.rawSqft, 0);
    const runs: WorldRun[] = run
      ? [
          {
            runId: rooms[0]?.provenance.runId || "this-session",
            created: run.created,
            rebound: run.rebound,
            held: run.held,
            orphaned: run.orphaned,
            failures: run.failures.length,
            declaredSqft: identity.declaredSqft,
            roomSqft: run.rooms.reduce((s, r) => s + r.rawSqft, 0),
            claimedWallSqft: run.claimedWallSqft,
            excludedSqft: run.excludedResidueSqft,
          },
        ]
      : [];
    const partial = {
      zone: identity,
      tags: meta.systemTag ? [meta.systemTag] : [],
      name: meta.name || `zone ${identity.key}`,
      rooms,
      residues,
      heldSqft,
      runs,
      driftSqft,
    };
    return { ...partial, stage: stageOf(partial) };
  });

  // Systems: the registry's tag list, joined to the zones that carry each tag. Loads are a
  // .r10 fact; until the reconcile lane reports them, sensible stays 0 (never invented).
  const systems: WorldSystem[] = status.systems.map((s) => ({
    guid: s.guid,
    tag: s.tag,
    zoneKeys: zones.filter((z) => z.tags.includes(s.tag)).map((z) => z.zone.key),
    sensibleBtuh: 0,
    overCap: false,
  }));

  return { docName: status.doc, r10Path: raw.r10Path, lanes, zones, systems };
}
