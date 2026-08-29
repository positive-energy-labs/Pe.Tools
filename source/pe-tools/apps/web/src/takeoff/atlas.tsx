import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import type { MasterTableState } from "#/components/master-table/model";
import { useTableChips } from "#/anatomy";
import { atlasRoomState, type AtlasRow as Row, type TakeoffStore } from "#/takeoff/store";
import {
  STAGE_ORDER,
  type RoomEdit,
  type Stage,
  type WorldLane,
  type WorldRoom,
  type WorldZone,
} from "#/takeoff/world";
import { AtlasProvider } from "#/takeoff/atlas-context";
import { AtlasWorkspace } from "#/takeoff/atlas-workspace";
import { useAtlasColumns } from "#/takeoff/atlas-columns";

export type Verdict = "accept" | "dismiss";

export interface AtlasActions {
  patch: (guid: string, patch: RoomEdit) => void;
  decide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  capture: (lane: WorldLane) => void;
  partition: (zone: WorldZone) => void;
  refresh: () => void;
}

export interface AtlasProps {
  store: TakeoffStore;
  headRail?: ReactNode;
  sidePanel?: ReactNode;
  readoutBand?: ReactNode;
}

const createAtlasActions = (store: TakeoffStore): AtlasActions => ({
  patch: (id, patch) => store.actions.patchRoom(id, patch),
  decide: (room, flag, verdict) => store.actions.decideRoom(room, flag, verdict),
  capture: (lane) => void store.actions.capture(lane).catch(() => undefined),
  partition: (zone) => void store.actions.partition(zone).catch(() => undefined),
  refresh: () => void store.actions.refresh().catch(() => undefined),
});

const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

const shortId = (guid: string) => guid.slice(guid.lastIndexOf("-") + 1);

function useAtlasModel({ store, headRail, sidePanel, readoutBand }: AtlasProps) {
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

  const setPlanOpen = (open: boolean) => store.actions.setAtlasPage({ planOpen: open });
  const setStatsOpen = (open: boolean) => store.actions.setAtlasPage({ statsOpen: open });

  const openFlags = (room: WorldRoom) => room.flags.filter((f) => !decided[flagKey(room.guid, f)]);

  const stateOf = (room: WorldRoom) => atlasRoomState(room, openFlags(room).length);
  const zoneStates = (z: WorldZone) => z.rooms.map((r) => stateOf(r));
  const zoneCalls = (z: WorldZone) => zoneStates(z).filter((s) => s === "call").length;

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

  const decide = (room: WorldRoom, flag: string, verb: Verdict) => {
    actions.decide(room, flag, verb);
  };

  const selectZone = (z: WorldZone | null) => {
    setZoneKey(z ? z.zone.key : null);
    setCursor(null);
    if (z) setLevel(z.zone.lane.label);
  };

  const columns = useAtlasColumns({ actions, fieldsMode, flagVocabulary, store });

  const chips = useTableChips({
    planScope: selected
      ? { label: `plan scope: ${selected.zone.key}`, onClear: () => selectZone(null) }
      : null,
    rail: stageFilter
      ? { label: `rail: ${stageFilter}`, onClear: () => setStageFilter(null) }
      : null,
  });

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

  return {
    store,
    headRail,
    sidePanel,
    readoutBand,
    world,
    live,
    busy,
    geoReady,
    actions,
    stageFilter,
    zoneKey,
    cursor,
    fieldsMode,
    planOpen,
    statsOpen,
    tableState,
    rows,
    visibleKeys,
    level,
    setStageFilter,
    setLevel,
    setZoneKey,
    setCursor,
    setPlanOpen,
    setStatsOpen,
    stateOf,
    zoneStates,
    zoneCalls,
    filteredZones,
    selected,
    setTableState,
    selectTableRow,
    hoverTableRow,
    levelZones,
    visibleRows,
    cursorRow,
    decide,
    selectZone,
    columns,
    chips,
    stageCounts,
    scopeCalls,
    scopeSqft,
    proposedUrl,
  };
}

export type AtlasModel = ReturnType<typeof useAtlasModel>;

export function Atlas(props: AtlasProps) {
  const model = useAtlasModel(props);
  return (
    <AtlasProvider value={model}>
      <AtlasWorkspace />
    </AtlasProvider>
  );
}
