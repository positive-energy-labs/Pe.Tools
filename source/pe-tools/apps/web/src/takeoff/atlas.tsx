import { useCallback, useMemo, type ReactNode } from "react";

import type { MasterTableState } from "#/components/master-table/model";
import { useTableChips } from "#/components/anatomy";
import type { PaneShortcut } from "#/components/lang/pane";
import { atlasRoomState, type AtlasRow as Row, type TakeoffStore } from "#/takeoff/store";
import {
  STAGE_ORDER,
  type RoomEdit,
  type Phase,
  type ModelRoom,
  type ModelZone,
} from "#/takeoff/world";
import { AtlasProvider } from "#/takeoff/atlas-context";
import { AtlasWorkspace } from "#/takeoff/atlas-workspace";
import { useAtlasColumns } from "#/takeoff/atlas-columns";

export type Verdict = "accept" | "dismiss";

export interface AtlasActions {
  patch: (guid: string, patch: RoomEdit) => void;
  decide: (room: ModelRoom, flag: string, verb: Verdict) => void;
  partition: (zone: ModelZone) => void;
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
  partition: () => void store.actions.partition().catch(() => undefined),
  refresh: () => void store.actions.refresh().catch(() => undefined),
});

const flagKey = (guid: string, flag: string) => `${guid}::${flag}`;

const shortId = (guid: string) => guid.slice(guid.lastIndexOf("-") + 1);

function useAtlasModel({ store, headRail, sidePanel, readoutBand }: AtlasProps) {
  const world = store.world;
  const views = store.views;
  const live = store.source === "live";
  const busyState = store.busy;
  const busy = busyState ? `${busyState.key} · ${busyState.seconds}s queued/running` : null;
  const snapshot = store.snapshot;
  const geoReady = snapshot?.state === "ready";
  const actions = useMemo(() => createAtlasActions(store), [store]);
  const stageFilter = store.stageFilter;
  const zoneKey = store.zoneKey;
  const pageLevel = store.level;
  const cursor = store.cursor;
  const fieldsMode = store.fieldsMode;
  const planOpen = store.planOpen;
  const statsOpen = store.statsOpen;
  const tableState = store.atlasTableState;
  const rows = store.atlasRows;
  const visibleKeys = store.visibleRows;
  const decided = store.decisions;
  // ponytail: one plan pane draws the first bound view; add comparison panes only if demanded.
  const firstBoundLane = world.lanes.find((lane) => lane.view === views[0]);
  const level = pageLevel || firstBoundLane?.label || world.lanes[0]?.label || "";
  const setStageFilter = (value: Phase | null) =>
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

  const openFlags = (room: ModelRoom) => room.flags.filter((f) => !decided[flagKey(room.guid, f)]);

  const stateOf = (room: ModelRoom) => atlasRoomState(room, openFlags(room).length);
  const zoneStates = (z: ModelZone) => z.rooms.map((r) => stateOf(r));
  const zoneCalls = (z: ModelZone) => zoneStates(z).filter((s) => s === "call").length;

  const filteredZones = useMemo(
    () => world.zones.filter((z) => stageFilter === null || z.stage === stageFilter),
    [world, stageFilter],
  );

  const selected = zoneKey ? (world.zones.find((z) => z.zone.guid === zoneKey) ?? null) : null;
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

  const decide = (room: ModelRoom, flag: string, verb: Verdict) => {
    actions.decide(room, flag, verb);
  };

  const clearScope = () => {
    setZoneKey(null);
    setCursor(null);
  };
  const moveCursor = (delta: -1 | 1) => {
    if (visibleRows.length === 0) return;
    const current = visibleRows.findIndex((row) => row.room.guid === cursor);
    const next = Math.max(0, Math.min(visibleRows.length - 1, current + delta));
    setCursor(visibleRows[current === -1 ? 0 : next]!.room.guid);
  };
  const decideCurrent = (verdict: Verdict) => {
    const flag = cursorRow?.open[0];
    if (cursorRow && flag) decide(cursorRow.room, flag, verdict);
  };
  const reviewShortcuts: readonly PaneShortcut[] = [
    {
      hotkey: "J",
      label: "next room",
      callback: () => moveCursor(1),
      options: { enabled: visibleRows.length > 0 },
    },
    {
      hotkey: "K",
      label: "previous room",
      callback: () => moveCursor(-1),
      options: { enabled: visibleRows.length > 0 },
    },
    {
      hotkey: "A",
      label: "accept first call",
      callback: () => decideCurrent("accept"),
      options: { enabled: (cursorRow?.open.length ?? 0) > 0 },
    },
    {
      hotkey: "D",
      label: "dismiss first call",
      callback: () => decideCurrent("dismiss"),
      options: { enabled: (cursorRow?.open.length ?? 0) > 0 },
    },
    {
      hotkey: "Escape",
      label: "clear room scope",
      callback: clearScope,
      options: { ignoreInputs: true, enabled: zoneKey !== null || cursor !== null },
    },
  ];
  const scopeShortcuts: readonly PaneShortcut[] = [
    {
      hotkey: "Escape",
      label: "clear room scope",
      callback: clearScope,
      options: { ignoreInputs: true, enabled: zoneKey !== null || cursor !== null },
    },
  ];

  const selectZone = (z: ModelZone | null) => {
    setZoneKey(z ? z.zone.guid : null);
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
    (selected ? `&zone=${encodeURIComponent(selected.zone.guid)}` : "") +
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
    geometry: snapshot,
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
    reviewShortcuts,
    scopeShortcuts,
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
