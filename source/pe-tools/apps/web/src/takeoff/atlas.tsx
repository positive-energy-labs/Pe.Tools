import { takeoffDecisionKey } from "@pe/agent-contracts";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { TableState } from "#/components/master-table/model";
import { useTableChips } from "#/components/anatomy";
import type { PaneShortcut } from "#/components/lang/pane";
import {
  atlasRoomState,
  visibleRowKeys,
  type AtlasRow as Row,
  type TakeoffsController,
} from "#/takeoff/controller";
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
  partition: () => void;
}

export interface AtlasProps {
  store: TakeoffsController;
  headRail?: ReactNode;
  sidePanel?: ReactNode;
  readoutBand?: ReactNode;
}

const createAtlasActions = (store: TakeoffsController): AtlasActions => ({
  patch: (id, patch) => store.actions.patchRoom(id, patch),
  decide: (room, flag, verdict) => store.actions.decideRoom(room, flag, verdict),
  partition: () => void store.handle.actions.partition.run(),
});

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
  // These are private widget mechanics. Remounting the Atlas intentionally resets them.
  const [fieldsMode, setFieldsMode] = useState<"columns" | "panel">("columns");
  const [planOpen, setPlanOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableState, setTableState] = useState<TableState>({
    filters: {},
    sorts: [],
    query: "",
  });
  const rows = store.atlasRows;
  const visibleKeys = useMemo(
    () => visibleRowKeys(rows, tableState, fieldsMode),
    [rows, tableState, fieldsMode],
  );
  const decided = store.decisions;
  // ponytail: one plan pane draws the first bound view; add comparison panes only if demanded.
  const firstBoundLane = world.lanes.find((lane) => lane.view === views[0]);
  const level = pageLevel || firstBoundLane?.label || world.lanes[0]?.label || "";
  const setStageFilter = (value: Phase | null) => store.actions.filterStage(value);
  const setLevel = useCallback((value: string) => store.actions.chooseLevel(value), [store]);
  const setCursor = useCallback((value: string | null) => store.actions.chooseRoom(value), [store]);

  const openFlags = (room: ModelRoom) =>
    room.flags.filter((f) => !decided[takeoffDecisionKey(room.guid, f)]);

  const stateOf = (room: ModelRoom) => atlasRoomState(room, openFlags(room).length);
  const zoneStates = (z: ModelZone) => z.rooms.map((r) => stateOf(r));
  const zoneCalls = (z: ModelZone) => zoneStates(z).filter((s) => s === "call").length;

  const filteredZones = useMemo(
    () => world.zones.filter((z) => stageFilter === null || z.stage === stageFilter),
    [world, stageFilter],
  );

  const selected = zoneKey ? (world.zones.find((z) => z.zone.guid === zoneKey) ?? null) : null;
  const selectTableRow = useCallback(
    (row: Row) => {
      store.actions.chooseRoom(row.room.guid, selected ? undefined : row.zone.zone.lane.label);
    },
    [selected, store],
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

  const clearScope = store.actions.clearRoomScope;
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
    store.actions.chooseZone(z ? z.zone.guid : null, z?.zone.lane.label);
  };
  const focusRoom = (z: ModelZone, room: string) =>
    store.actions.focusRoom(z.zone.guid, room, z.zone.lane.label);

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

  const proposedUrl = new URL("/takeoffs", "https://pe.local");
  if (store.target) proposedUrl.searchParams.set("target", store.target);
  if (level) proposedUrl.searchParams.set("level", level);
  if (selected) proposedUrl.searchParams.set("zone", selected.zone.guid);
  if (cursorRow) proposedUrl.searchParams.set("room", cursorRow.room.guid);

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
    setFieldsMode,
    planOpen,
    statsOpen,
    tableState,
    rows,
    visibleKeys,
    level,
    setStageFilter,
    setLevel,
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
    focusRoom,
    clearScope,
    columns,
    chips,
    stageCounts,
    scopeCalls,
    scopeSqft,
    proposedUrl: `${proposedUrl.pathname}${proposedUrl.search}`,
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
