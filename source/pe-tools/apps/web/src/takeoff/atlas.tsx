/** Atlas — the /takeoffs workspace: plan-dominant three-pane. */
//
// The PLAN is the scope master, the TABLE always answers "everything currently in scope". No zone
// selected = the whole house is in the table; selecting a zone on the plan narrows it. The table
// is never hidden and never collapses into a per-zone detail pane — that is the structural law.
//
// Progress is DERIVED from room facts and rendered with ONE vocabulary on all three surfaces:
// the rail's per-zone segment bar, the plan's room fills, and the table's state column all read
// the same four room states. The zone stage survives only as a filterable text column.
//
// The atlas renders a `World` and calls back through `AtlasActions` — it owns selection and
// optimistic decision state, nothing else. The route owns the world, the overlay, and every
// host call.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import type { MasterTableState } from "#/components/master-table/model";
import { useTableChips } from "#/anatomy";
import { atlasRoomState, type AtlasRow as Row, type TakeoffStore } from "#/takeoff/store";
import { STAGE_ORDER, type RoomEdit, type Stage, type WorldLane, type WorldRoom, type WorldZone } from "#/takeoff/world";
import { AtlasProvider } from "#/takeoff/atlas-context";
import { AtlasWorkspace } from "#/takeoff/atlas-workspace";
import { useAtlasColumns } from "#/takeoff/atlas-columns";

export type Verdict = "accept" | "dismiss";

export interface AtlasActions {
  /** Stage a Manual J / naming edit (session overlay; the .r10 takes it at sync). */
  patch: (guid: string, patch: RoomEdit) => void;
  /** Write-through: persist onto the Room Region blob (live) or accept locally (fixture). */
  decide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  capture: (lane: WorldLane) => void;
  partition: (zone: WorldZone) => void;
  refresh: () => void;
}

export interface AtlasProps {
  store: TakeoffStore;
}

const createAtlasActions = (store: TakeoffStore): AtlasActions => ({
  patch: (id, patch) => store.actions.patchRoom(id, patch),
  decide: (room, flag, verdict) => store.actions.decideRoom(room, flag, verdict),
  capture: (lane) => void store.actions.capture(lane).catch(() => undefined),
  partition: (zone) => void store.actions.partition(zone).catch(() => undefined),
  refresh: () => void store.actions.refresh().catch(() => undefined),
});

// ── Room state — the one progress vocabulary ────────────────────────────────
//
// Derived from the room's own facts, never from its zone's stage label. Four states, spent on the
// design language's MEANING BAND (`--pe-*`) rather than the viz ladder: the old `--cat-*` spends
// were taxonomy colours carrying state, which is exactly the violation the route passes exist to
// fix. The mapping is an argument, not a convenience:
//   call      → --pe-alarm     the one alarm: a person is required, because the model or the
//                             detector disagrees with what is recorded.
//   unreviewed→ --pe-ink-mute  the "never checked" rank — nothing has been entered here at all.
//   data      → --pe-caution   unsaved: the Manual J numbers exist only in this session's overlay
//                             until a sync moves them into the .r10.
//   synced    → --pe-done      it landed.
//
// NOTE: these four are a
// row-level PIPELINE VERDICT, not the cell grammar's state axes — the column rides the table's
// `verdict:` clause, whose tone union is the meaning band by construction.

const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

const shortId = (guid: string) => guid.slice(guid.lastIndexOf("-") + 1);

/**
 * Zones smaller than this are stray scribbles in the fixture (Lower#01 at 42 sf sits ~100 ft from
 * the real cluster). Drawing them blew the plan's viewBox out and rendered the actual house as
 * specks. They are excluded from the plan and from its bounds fit — but never deleted from the
 * rail, where they stay visible and marked, because silently dropping declared geometry is worse
 * than an ugly plan.
 */
function useAtlasModel(store: TakeoffStore) {
  const world = useAtomValue(store.atoms.world);
  const views = useAtomValue(store.atoms.views);
  const live = store.source === "live";
  const busyState = useAtomValue(store.atoms.busy);
  const busy = busyState ? `${busyState.id} · ${busyState.seconds}s queued/running` : null;
  const snapshot = useAtomValue(store.atoms.snapshot);
  const geoReady = AsyncResult.isSuccess(snapshot) && snapshot.value.bound;
  const actions = useMemo(() => createAtlasActions(store), [store]);
  const stageFilter = useAtomValue(store.atoms.stageFilter);
  const zoneKey = useAtomValue(store.atoms.zoneKey);
  const pageLevel = useAtomValue(store.atoms.level);
  const cursor = useAtomValue(store.atoms.cursor);
  const fieldsMode = useAtomValue(store.atoms.fieldsMode);
  const planOpen = useAtomValue(store.atoms.planOpen);
  const statsOpen = useAtomValue(store.atoms.statsOpen);
  const tableState = useAtomValue(store.atoms.atlasTableState);
  const rows = useAtomValue(store.atoms.atlasRows);
  const visibleKeys = useAtomValue(store.atoms.visibleRows);
  const decided = useAtomValue(store.atoms.decisions);
  // ponytail: one plan pane draws the first bound view; add comparison panes only if demanded.
  const firstBoundLane = world.lanes.find((lane) => lane.view === views[0]);
  const level = pageLevel || firstBoundLane?.label || world.lanes[0]?.label || "";
  const setStageFilter = (value: Stage | null) =>
    store.actions.setAtlasPage({ stageFilter: value });
  const setLevel = useCallback(
    (value: string) => store.actions.setAtlasPage({ level: value }),
    [store],
  );
  const setZoneKey = (value: string | null) => store.actions.setAtlasPage({ zoneKey: value });
  const setCursor = useCallback(
    (value: string | null) => store.actions.setAtlasPage({ cursor: value }),
    [store],
  );
  /** Where the per-room Manual J fields live: inline table columns (dense, whole-scope entry)
   *  or the room panel (narrow table, one room in focus). One home at a time, never both. */
  /** The row order the user is actually looking at — MasterTable owns filter/sort/search, and
   *  reports the result here so j/k walks the SAME order rather than the pre-filter scope. */

  // Plan geometry: controlled collapse; PaneWorkspace owns and persists its resized height.
  const setPlanOpen = (open: boolean) => store.actions.setAtlasPage({ planOpen: open });
  const setStatsOpen = (open: boolean) => store.actions.setAtlasPage({ statsOpen: open });

  // Edits live in the route's session overlay (they must survive into the sync payload); the
  // world arrives with them already applied. The atlas only forwards patches.
  const openFlags = (room: WorldRoom) => room.flags.filter((f) => !decided[flagKey(room.guid, f)]);

  const stateOf = (room: WorldRoom) => atlasRoomState(room, openFlags(room).length);
  const zoneStates = (z: WorldZone) => z.rooms.map((r) => stateOf(r));
  const zoneCalls = (z: WorldZone) => zoneStates(z).filter((s) => s === "call").length;

  // ── Scope derivation ──────────────────────────────────────────────────────
  // Rail pipeline filter narrows the world; the plan selects within it; the table shows the result.

  const filteredZones = useMemo(
    () => world.zones.filter((z) => stageFilter === null || z.stage === stageFilter),
    [world, stageFilter],
  );

  const selected = zoneKey ? (world.zones.find((z) => z.zone.key === zoneKey) ?? null) : null;
  const setTableState = useCallback(
    (state: MasterTableState) => store.actions.setTableState(state),
    [store],
  );
  const selectTableRow = useCallback(
    (row: Row) => {
      setCursor(row.room.guid);
      if (!selected) setLevel(row.zone.zone.lane.label);
    },
    [selected, setCursor, setLevel],
  );
  const hoverTableRow = useCallback(
    (row: Row | null) => store.actions.hover(row?.room.guid ?? ""),
    [store],
  );
  const levelZones = world.zones.filter((z) => z.zone.lane.label === level);

  // Scope only — plan selection and the rail's pipeline filter. Every other narrowing (stage,
  // state, type, flags, free text) is the table's own, and shows as a chip in its strip.
  // What the table is actually showing, in its order.
  const visibleRows = useMemo(() => {
    const byGuid = new Map(rows.map((r) => [r.room.guid, r]));
    return visibleKeys.map((key) => byGuid.get(key)).filter((r): r is Row => r !== undefined);
  }, [rows, visibleKeys]);

  const cursorRow = rows.find((r) => r.room.guid === cursor) ?? null;

  const flagVocabulary = useMemo(() => {
    const set = new Set<string>();
    for (const z of world.zones) for (const r of z.rooms) for (const f of r.flags) set.add(f);
    return [...set].sort();
  }, [world]);

  // ── Keyboard: j/k cursor, a/d verbs, Esc clears scope (←/→ belong to the switcher) ──
  const keydown = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keydown.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key === "Escape") {
      setZoneKey(null);
      setCursor(null);
      return;
    }
    if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      if (visibleRows.length === 0) return;
      const i = visibleRows.findIndex((r) => r.room.guid === cursor);
      const next = e.key === "j" ? Math.min(visibleRows.length - 1, i + 1) : Math.max(0, i - 1);
      setCursor(visibleRows[i === -1 ? 0 : next]!.room.guid);
      return;
    }
    if ((e.key === "a" || e.key === "d") && cursorRow) {
      if (cursorRow.open.length === 0) return;
      e.preventDefault();
      decide(cursorRow.room, cursorRow.open[0]!, e.key === "a" ? "accept" : "dismiss");
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keydown.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Optimistic: mark locally, then write through. The route re-reads on demand; a failed
  // write surfaces through the route's error lane, never as a silently-kept decision.
  const decide = (room: WorldRoom, flag: string, verb: Verdict) => {
    actions.decide(room, flag, verb);
  };

  const selectZone = (z: WorldZone | null) => {
    setZoneKey(z ? z.zone.key : null);
    setCursor(null);
    if (z) setLevel(z.zone.lane.label);
  };

  // ── The table's columns. One descriptor per column; MasterTable owns filter/sort/search. ──
  const columns = useAtlasColumns({ actions, fieldsMode, flagVocabulary, store });

  // Chips the ROUTE owns. The table's own column filters chip themselves.
  const chips = useTableChips({
    planScope: selected
      ? { label: `plan scope: ${selected.zone.key}`, onClear: () => selectZone(null) }
      : null,
    rail: stageFilter
      ? { label: `rail: ${stageFilter}`, onClear: () => setStageFilter(null) }
      : null,
  });

  // ── Census ────────────────────────────────────────────────────────────────
  const stageCounts = STAGE_ORDER.map((s) => ({
    stage: s,
    n: world.zones.filter((z) => z.stage === s).length,
  }));
  const scopeCalls = visibleRows.filter((r) => r.state === "call").length;
  const scopeSqft = visibleRows.reduce((s, r) => s + r.room.sqft, 0);

  const proposedUrl =
    `/takeoffs?level=${level}` +
    (selected ? `&zone=${encodeURIComponent(selected.zone.key)}` : "") +
    (cursorRow ? `&room=${shortId(cursorRow.room.guid)}` : "");

  return { store, world, live, busy, geoReady, actions, stageFilter, zoneKey, cursor, fieldsMode, planOpen, statsOpen, tableState, rows, visibleKeys, level, setStageFilter, setLevel, setZoneKey, setCursor, setPlanOpen, setStatsOpen, stateOf, zoneStates, zoneCalls, filteredZones, selected, setTableState, selectTableRow, hoverTableRow, levelZones, visibleRows, cursorRow, decide, selectZone, columns, chips, stageCounts, scopeCalls, scopeSqft, proposedUrl };
}

export type AtlasModel = ReturnType<typeof useAtlasModel>;

export function Atlas({ store }: AtlasProps) {
  const model = useAtlasModel(store);
  return (
    <AtlasProvider value={model}>
      <AtlasWorkspace />
    </AtlasProvider>
  );
}

// ── The plan ────────────────────────────────────────────────────────────────
