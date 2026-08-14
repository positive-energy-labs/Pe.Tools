/**
 * Ambiguity-flag resolutions — the durable, replayable record of the human
 * decisions the detector refused to make. Two verbs only: accept a flag, or
 * reject the room. Geometry is authored in Revit, never here (DECISIONS.md,
 * "recalc proposes; the designer's shape wins until accepted").
 *
 * A resolutions sidecar is deterministic JSON (no timestamps): applied to the
 * same parsed takeoff it always yields the same rooms, so it survives reload
 * and replays against re-runs. `TakeoffResolutions.ApplyResolutions` (C#) is
 * the sidecar's twin and must stay behaviourally identical; rejected rooms
 * become claimed residue so conserved gray geometry stays explicit in both.
 *
 * Persistence is localStorage per takeoff source plus downloadable JSON; the
 * `rhvac.takeoff-resolutions` host op (src/host/rhvac.ts) persists the same
 * shape as `<dir>/takeoff-resolutions.json`.
 */
import {
  candidateKey,
  isDecisionFlag,
  type TakeoffLevel,
  type TakeoffResidueShape,
  type TakeoffRoomShape,
} from "#/rhvac/types";
import {
  sortRhvacResolutions,
  type RhvacResolutionsFile,
  type RhvacTakeoffResolution,
} from "@pe/host-contracts/operation-types";
export { sortRhvacResolutions as sortResolutions } from "@pe/host-contracts/operation-types";

// ── sidecar schema ───────────────────────────────────────────────────────────

export type FlagResolution = RhvacTakeoffResolution;
export type ResolutionsFile = RhvacResolutionsFile;

export interface ResolutionApplyResult {
  levels: TakeoffLevel[];
  applied: number;
  remapped: number;
  orphaned: number;
}

/** Replace any prior resolution of the same (candidateKey, flag), keep the rest. */
export const upsertResolution = (
  resolutions: FlagResolution[],
  next: FlagResolution,
): FlagResolution[] =>
  sortRhvacResolutions([
    ...resolutions.filter((r) => r.candidateKey !== next.candidateKey || r.flag !== next.flag),
    next,
  ]);

// ── applying resolutions to parsed levels ────────────────────────────────────

/**
 * Pure and idempotent: v1 resolves by key only; v2 verifies the key against its
 * anchor, remaps by same-level containment, and accounts for every orphan.
 * Accept clears the flag; reject moves the room into claimed rejected residue.
 * apply(apply(x)) === apply(x) because a rejected room is gone on the second pass.
 */
export function applyResolutions(
  levels: TakeoffLevel[],
  resolutions: FlagResolution[],
  version: ResolutionsFile["version"] = 1,
): ResolutionApplyResult {
  if (resolutions.length === 0) return { levels, applied: 0, remapped: 0, orphaned: 0 };
  const rooms = levels.flatMap((level) =>
    level.rooms.map((room) => ({
      levelName: level.levelName,
      key: candidateKey(level.levelName, room.id),
      room,
    })),
  );
  const byKey = new Map<string, FlagResolution[]>();
  let applied = 0;
  let remapped = 0;
  let orphaned = 0;

  const resolveCandidate = (
    key: string,
    anchor: FlagResolution["anchor"],
  ): { target: (typeof rooms)[number] | undefined; remapped: boolean } => {
    const exact = rooms.find((candidate) => candidate.key === key);
    if (exact?.room.native) return { target: undefined, remapped: false };
    if (version === 1) return { target: exact, remapped: false };
    if (!anchor) return { target: undefined, remapped: false };
    if (
      exact &&
      pointInShape(anchor.label, exact.room) &&
      Math.abs(exact.room.rawSqft - anchor.sqft) <= anchor.sqft * 0.2
    )
      return { target: exact, remapped: false };
    const separator = key.lastIndexOf(":");
    const levelName = separator < 0 ? "" : key.slice(0, separator);
    return {
      target: rooms.find(
        (candidate) =>
          !candidate.room.native &&
          candidate.levelName === levelName &&
          pointInShape(anchor.label, candidate.room),
      ),
      remapped: true,
    };
  };

  for (const resolution of resolutions) {
    // split/merge/claim-residue are RETIRED (geometry is authored in Revit now). A pre-pivot
    // sidecar still parses, but the decision can no longer be replayed — count it as an orphan
    // so the loss is reported, never silently dropped. The C# twin does the same.
    if (resolution.action !== "accept" && resolution.action !== "reject") {
      orphaned++;
      continue;
    }
    const sourceResolution = resolveCandidate(resolution.candidateKey, resolution.anchor);
    const sourceCandidate = sourceResolution.target;
    if (!sourceCandidate) {
      orphaned++;
      continue;
    }
    if (sourceResolution.remapped) remapped++;
    else applied++;
    const list = byKey.get(sourceCandidate.key) ?? [];
    list.push(resolution);
    byKey.set(sourceCandidate.key, list);
  }

  const resolved = levels.map((level) => {
    const rejectedResidues: TakeoffResidueShape[] = [];
    return {
      ...level,
      rooms: level.rooms.flatMap((room) => {
        const forRoom = byKey.get(candidateKey(level.levelName, room.id));
        if (!forRoom) return [room];

        if (forRoom.some((r) => r.action === "reject")) {
          rejectedResidues.push({
            id: room.id,
            reason: "rejected",
            claimed: true,
            rawSqft: room.rawSqft,
            meanCeilingFt: room.meanCeilingFt,
            label: room.label,
            outer: room.outer,
            holes: room.holes,
          });
          return [];
        }

        const accepted = new Set(forRoom.filter((r) => r.action === "accept").map((r) => r.flag));
        const remaining = (room.flags ?? []).filter((f) => !accepted.has(f));
        if (remaining.length === (room.flags?.length ?? 0)) return [room];
        const { flags: _dropped, ...rest } = room;
        return [remaining.length > 0 ? { ...rest, flags: remaining } : rest];
      }),
      residues: level.residues.concat(rejectedResidues),
    };
  });
  return { levels: resolved, applied, remapped, orphaned };
}

const pointInRing = (p: readonly [number, number], ring: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

const pointInShape = (point: readonly [number, number], room: TakeoffRoomShape): boolean =>
  pointInRing(point, room.outer) && !room.holes.some((hole) => pointInRing(point, hole));

// ── pending-flag queue derivation ────────────────────────────────────────────

export interface PendingFlag {
  levelName: string;
  levelIndex: number;
  roomId: string;
  candidateKey: string;
  flag: string;
  rawSqft: number;
  anchor: NonNullable<FlagResolution["anchor"]>;
}

/** Flags still awaiting a decision, in level order then area-descending (room order). */
export function pendingFlags(levels: TakeoffLevel[]): PendingFlag[] {
  return levels.flatMap((level, levelIndex) =>
    level.rooms.flatMap((room) =>
      room.rejected
        ? []
        : (room.flags?.filter(isDecisionFlag).map((flag) => ({
            levelName: level.levelName,
            levelIndex,
            roomId: room.id,
            candidateKey: candidateKey(level.levelName, room.id),
            flag,
            rawSqft: room.rawSqft,
            anchor: { label: room.label, sqft: room.rawSqft },
          })) ?? []),
    ),
  );
}

// ── persistence (fixture lane: localStorage + downloadable JSON) ─────────────

const storageKey = (sourceKey: string) => `rhvac:takeoff-resolutions:${sourceKey}`;

export function loadStoredResolutions(sourceKey: string): ResolutionsFile | null {
  try {
    const raw = localStorage.getItem(storageKey(sourceKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolutionsFile;
    return (parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.resolutions)
      ? { ...parsed, resolutions: sortRhvacResolutions(parsed.resolutions) }
      : null;
  } catch {
    return null;
  }
}

export function storeResolutions(sourceKey: string, file: ResolutionsFile | null): void {
  try {
    if (!file || file.resolutions.length === 0) localStorage.removeItem(storageKey(sourceKey));
    else localStorage.setItem(storageKey(sourceKey), JSON.stringify(file, null, 2));
  } catch {
    // storage unavailable — resolutions still live for this session.
  }
}

export const toResolutionsFile = (
  resolutions: readonly FlagResolution[],
  tsvSha256: Record<string, string>,
  version: ResolutionsFile["version"] = 2,
): ResolutionsFile => ({
  version,
  ...(version === 2 ? { tsvSha256: sortHashes(tsvSha256) } : {}),
  resolutions: sortRhvacResolutions(resolutions),
});

export const provenanceMismatch = (
  sidecar: ResolutionsFile | null,
  current: Record<string, string>,
): boolean =>
  sidecar?.version === 2 &&
  JSON.stringify(sidecar.tsvSha256 ?? {}) !== JSON.stringify(sortHashes(current));

const sortHashes = (hashes: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)));
