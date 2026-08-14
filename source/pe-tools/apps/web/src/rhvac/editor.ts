/**
 * /rhvac editor state — one loaded extract, rooms edited in place, dirty and
 * deleted tracked against a baseline snapshot. Loads are calc outputs: any
 * edit anywhere marks them stale (sticky — saving the .r10 does not re-run
 * the calc; only Preview Loads in RHVAC does).
 */
import { useCallback, useMemo, useState } from "react";

import type { RhvacBuilding, RhvacExtract, RhvacRoom, RhvacSystem } from "#/rhvac/types";

/** Key-order-insensitive JSON so a re-spread room still matches its baseline. */
function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_k, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    ) ?? ""
  );
}

interface LoadedDoc {
  sourcePath: string;
  building: RhvacBuilding;
  systems: RhvacSystem[];
}

export interface BulkAssignPatch {
  systemNumber?: number;
}

export function useRhvacEditor() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [rooms, setRooms] = useState<RhvacRoom[]>([]);
  const [baseline, setBaseline] = useState<Map<number, string>>(new Map());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  // Sticky: once any edit exists, calc outputs are stale until RHVAC re-runs —
  // saving the file does NOT clear this.
  const [loadsStale, setLoadsStale] = useState(false);

  const load = useCallback((extract: RhvacExtract, sourcePath: string) => {
    setDoc({ sourcePath, building: extract.building, systems: extract.systems });
    setRooms(extract.rooms);
    setBaseline(new Map(extract.rooms.map((room) => [room.identifier, stableJson(room)])));
    setDeleted(new Set());
    setLoadsStale(false);
  }, []);

  const updateRoom = useCallback((identifier: number, mutate: (room: RhvacRoom) => RhvacRoom) => {
    setRooms((prev) => prev.map((room) => (room.identifier === identifier ? mutate(room) : room)));
    setLoadsStale(true);
  }, []);

  const bulkAssign = useCallback((identifiers: ReadonlySet<number>, patch: BulkAssignPatch) => {
    setRooms((prev) =>
      prev.map((room) => (identifiers.has(room.identifier) ? { ...room, ...patch } : room)),
    );
    setLoadsStale(true);
  }, []);

  const deleteRooms = useCallback((identifiers: ReadonlyArray<number>) => {
    setDeleted((prev) => new Set([...prev, ...identifiers]));
    setLoadsStale(true);
  }, []);

  const undeleteRoom = useCallback((identifier: number) => {
    setDeleted((prev) => {
      const next = new Set(prev);
      next.delete(identifier);
      return next;
    });
  }, []);

  /** After a successful save: current state becomes the new baseline, deleted rooms drop out. */
  const markSaved = useCallback(() => {
    setRooms((prev) => {
      const kept = prev.filter((room) => !deleted.has(room.identifier));
      setBaseline(new Map(kept.map((room) => [room.identifier, stableJson(room)])));
      return kept;
    });
    setDeleted(new Set());
  }, [deleted]);

  const dirtyIds = useMemo(() => {
    const ids = new Set<number>();
    for (const room of rooms)
      if (baseline.get(room.identifier) !== stableJson(room)) ids.add(room.identifier);
    return ids;
  }, [rooms, baseline]);

  /** Rooms going into rhvac.save updates: edited, not deleted, sent whole. */
  const pendingUpdates = useMemo(
    () => rooms.filter((room) => dirtyIds.has(room.identifier) && !deleted.has(room.identifier)),
    [rooms, dirtyIds, deleted],
  );

  return {
    doc,
    rooms,
    dirtyIds,
    deleted,
    loadsStale,
    pendingUpdates,
    load,
    updateRoom,
    bulkAssign,
    deleteRooms,
    undeleteRoom,
    markSaved,
  };
}

export type RhvacEditor = ReturnType<typeof useRhvacEditor>;
