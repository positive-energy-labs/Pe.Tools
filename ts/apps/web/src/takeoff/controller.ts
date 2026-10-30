/**
 * Takeoffs controller: route projections and dependent transitions.
 *
 * The owner, the registry, the conflict banner, refusal plumbing, the Target resolution and the
 * host caller all live in `useRoute`; action semantics live in `takeoff/actions.ts`. This file
 * projects the document into Takeoffs views and owns cleanup when target or scope changes.
 */
import { useCallback, useMemo } from "react";
import type {
  PlaneViewport,
  Reading,
  StagedRoomEdit,
  TakeoffCapture,
  TakeoffSnapshot,
  TakeoffObservation,
} from "@pe/agent-contracts";
import {
  stagedAdoptChoices,
  stagedDecisions,
  stagedReviewFlags,
  stagedTakeoffEdits,
  takeoffDecisionAddress,
  takeoffDecisionKey,
  takeoffEditPatches,
  takeoffFlagToggle,
  transitionPatches,
} from "@pe/agent-contracts";

import type { NativeObservation } from "#/revit/observation";
import type { CellWire } from "#/components/work/band";
import { previousOf, useHostCall } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { useRoute } from "#/route/use-route";
import { DEMO_CANDIDATES, snapshotOfObservation, syncPlan } from "#/takeoff/actions";
import { readCandidates } from "#/takeoff/host";
import { manifest } from "#/takeoff/manifest";
import { type RoomEdit, type ModelRoom } from "#/takeoff/world";

/* ── Page memory ───────────────────────────────────────────────────────────── */

export {
  atlasRoomState,
  ATLAS_ROOM_STATES,
  ATLAS_ROOM_STATE_LABEL,
  ATLAS_COLUMN_SEMANTICS,
} from "./projections";
export type { AtlasRoomState, AtlasRow, AdoptDraft, TakeoffSelection } from "./projections";
import {
  EMPTY_WORLD,
  withEditBases,
  roomEdit,
  stagedModel,
  atlasRows,
  adoptDrafts,
  type AdoptDraft,
  type TakeoffSelection,
} from "./projections";
interface TakeoffNavigation {
  readonly level: string;
  readonly zone: string | null;
  readonly room: string | null;
}
const EMPTY_TAKEOFF_SELECTION: TakeoffSelection = { views: [], zones: [], r10: "", stage: "adopt" };

/* ── One route handle plus Takeoffs projections and transitions ───────────── */

const observed = <T>(reading: Reading<unknown> | undefined): T | undefined =>
  reading === undefined
    ? undefined
    : reading.state === "ready"
      ? (reading.observation as T)
      : (previousOf(reading) as T | undefined);

export function useTakeoffsController(options: {
  target?: string;
  /** The thread whose head is the target store (a chat pane). */
  thread?: string;
  work?: string;
  savedCapture?: TakeoffCapture;
  url?: boolean;
}) {
  const handle = useRoute(manifest, {
    url: options.url ?? false,
    target: options.target ? (options.target as never) : null,
    ...(options.work !== undefined ? { work: options.work } : {}),
    ...(options.thread ? { thread: options.thread } : {}),
  });
  const [page, setPage] = handle.page;
  const navigation: TakeoffNavigation = {
    level: page.level,
    zone: page.zone || null,
    room: page.room || null,
  };
  const setNavigation = useCallback(
    (next: Partial<TakeoffNavigation>) => {
      setPage(
        {
          ...(next.level === undefined ? {} : { level: next.level }),
          ...(next.zone === undefined ? {} : { zone: next.zone ?? "" }),
          ...(next.room === undefined ? {} : { room: next.room ?? "" }),
          ...(next.level === undefined || next.level === page.level ? {} : { viewport: null }),
        },
        { history: "push" },
      );
    },
    [setPage, page.level],
  );

  const observation = handle.readings.snapshot as Reading<TakeoffObservation> | undefined;
  const projectSnapshot = (): Reading<TakeoffSnapshot> => {
    if (!observation || observation.state === "absent") return { state: "absent" };
    const value = observed<TakeoffObservation>(observation);
    const previous = snapshotOfObservation(value);
    if (observation.state !== "ready") {
      if (observation.state === "stale")
        return previous ? { ...observation, previous } : { state: "absent" };
      return { ...observation, previous };
    }
    if (value?.kind === "failed") return { state: "failed", message: value.error, previous };
    if (value?.kind === "reading")
      return previous ? { state: "stale", previous, reason: "dirtied" } : { state: "absent" };
    return previous ? { state: "ready", observation: previous } : { state: "absent" };
  };
  const snapshot = projectSnapshot();
  const capture = options.savedCapture;
  const displayed = observed<TakeoffObservation>(observation);
  const nativeCapture =
    displayed?.kind === "ready"
      ? displayed.capture
      : displayed && "previous" in displayed
        ? displayed.previous
        : undefined;
  const authority =
    capture?.snapshot?.world ?? observed<TakeoffSnapshot>(snapshot)?.world ?? EMPTY_WORLD;
  const nativeObservation = useMemo<NativeObservation>(
    () => ({
      scope: {
        document: handle.demo || capture ? null : (nativeCapture?.provenance.target ?? null),
        source: handle.demo ? "fixture" : capture ? "saved" : "native",
      },
      references: authority.zones.flatMap((zone) => [
        { elementId: zone.zone.elementId },
        ...zone.rooms.map((room) => ({ elementId: room.elementId })),
      ]),
    }),
    [handle.demo, capture, nativeCapture, authority],
  );
  // The person's edit cells only; Pea's proposals are not drawn here yet (interaction's cutover).
  const edit = useMemo(
    (): Record<string, StagedRoomEdit> =>
      handle.work.doc ? stagedTakeoffEdits(handle.work.doc) : {},
    [handle.work.doc],
  );
  const world = useMemo(() => stagedModel(authority, edit), [authority, edit]);
  /*
   * The adopt pane's one source: the host's `takeoffs.candidates` (every filled region on each
   * chosen view, stamped or not). `snapshot.zoneFrs` holds only regions already stamped, so it can
   * never offer a region to adopt (hold 4a, D4). The demo lane answers the same call from its seed.
   */
  const bound =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const candidatesCall = useHostCall(
    async () => {
      if (handle.demo) return DEMO_CANDIDATES.filter((region) => page.views.includes(region.view));
      return readCandidates(bound!, page.views);
    },
    ["takeoffs.candidates", bound?.session, bound?.openId, handle.demo, page.views.join("|")],
    (handle.demo || bound !== null) && page.views.length > 0,
    NATIVE_READ_WAIT_S,
  );
  const candidates = candidatesCall.data;
  const adoptPatches = useMemo(
    () => (handle.work.doc ? stagedAdoptChoices(handle.work.doc) : {}),
    [handle.work.doc],
  );
  const decisions = useMemo(
    () => (handle.work.doc ? stagedDecisions(handle.work.doc) : {}),
    [handle.work.doc],
  );
  const adoptRows = useMemo(
    () => (candidates ? adoptDrafts(candidates, adoptPatches) : null),
    [candidates, adoptPatches],
  );
  const rows = useMemo(() => atlasRows(world, decisions), [world, decisions]);
  const plan = useMemo(
    () => syncPlan(authority, page.zones, edit, decisions),
    [authority, page.zones, edit, decisions],
  );
  const review = useMemo(() => {
    const zoneKey = navigation.zone;
    const zone = world.zones.find((item) => item.zone.guid === zoneKey);
    return zoneKey && zone?.savedReview
      ? {
          zone: zoneKey,
          data: zone.savedReview,
          flags: handle.work.doc ? (stagedReviewFlags(handle.work.doc)[zoneKey] ?? []) : [],
          source: "saved native" as const,
        }
      : null;
  }, [navigation.zone, world, handle.work.doc]);

  const entity = useCallback(
    (id: string) => {
      const pendingEdit = edit[id];
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      return {
        bound: room?.elementId !== null && room !== undefined,
        decided: Object.keys(decisions).some((key) => takeoffDecisionAddress(key).roomGuid === id),
        edit: pendingEdit ?? null,
        dirty: pendingEdit !== undefined,
        conflict:
          pendingEdit !== undefined &&
          room !== undefined &&
          JSON.stringify(pendingEdit.base) !== JSON.stringify(roomEdit(room)),
      };
    },
    [edit, authority, decisions],
  );

  const stageEdit = useCallback(
    (id: string, next: RoomEdit) => {
      const room = authority.zones.flatMap((zone) => zone.rooms).find((r) => r.guid === id);
      if (!room || !handle.work.doc) return Promise.resolve(null);
      return handle.work.write(takeoffEditPatches(handle.work.doc, id, roomEdit(room), next));
    },
    [authority, handle.work],
  );

  const actions = useMemo(
    () => ({
      partition: () => void handle.actions.partition.run(),
      chooseViews: (views: readonly string[]) => {
        const allowed = new Set(
          world.zones
            .filter((zone) => views.includes(zone.zone.lane.view))
            .map((zone) => zone.zone.guid),
        );
        setPage({
          views,
          viewport: null,
          zones: page.zones.filter((zone) => allowed.has(zone)),
          panel: null,
          syncReview: null,
        });
        setNavigation({ level: "", zone: null, room: null });
      },
      chooseZones: (zones: readonly string[]) => {
        const clearsFocus = navigation.zone !== null && !zones.includes(navigation.zone);
        setPage({
          zones,
          panel: null,
          syncReview: null,
        });
        if (clearsFocus) setNavigation({ zone: null, room: null });
      },
      chooseR10: (r10: string) => setPage({ r10, panel: null, syncReview: null }),
      chooseStage: (stage: TakeoffSelection["stage"]) =>
        setPage({ stage, panel: null, syncReview: null }),
      chooseLevel: (level: string) => setNavigation({ level, zone: null, room: null }),
      chooseZone: (zone: string | null, level?: string) => {
        const changesScope = zone !== null && !page.zones.includes(zone);
        setNavigation({
          zone,
          room: null,
          ...(level === undefined ? {} : { level }),
        });
        if (changesScope) setPage({ zones: [zone], panel: null, syncReview: null });
      },
      chooseRoom: (room: string | null, level?: string) =>
        setNavigation({ room, ...(level === undefined ? {} : { level }) }),
      focusRoom: (zone: string, room: string, level: string) => {
        const changesScope = !page.zones.includes(zone);
        setNavigation({ zone, room, level });
        if (changesScope) setPage({ zones: [zone], panel: null, syncReview: null });
      },
      clearRoomScope: () => setNavigation({ zone: null, room: null }),
      resetTarget: () => {
        setPage({
          ...EMPTY_TAKEOFF_SELECTION,
          viewport: null,
          panel: null,
          syncReview: null,
        });
        setNavigation({ level: "", zone: null, room: null });
      },
      openPanel: (panel: "sync" | null) =>
        setPage({ panel, ...(panel === null ? { syncReview: null } : {}) }),
      patchAdopt: (
        view: string,
        elementId: number,
        next: Partial<Pick<AdoptDraft, "checked" | "name" | "systemTag">>,
      ) => {
        // The row's whole draft, so `adopt` reads a ticked candidate from Work alone (29).
        const row = adoptRows?.find((r) => r.view === view && r.region.elementId === elementId);
        const draft = row && { checked: row.checked, name: row.name, systemTag: row.systemTag };
        void handle.work.write(
          transitionPatches(
            ["adopt"],
            `${view}:${elementId}`,
            {},
            {
              kind: "set",
              rung: { value: { ...adoptPatches[`${view}:${elementId}`], ...draft, ...next } },
            },
          ),
        );
      },
      patchRoom: (id: string, next: RoomEdit) => void stageEdit(id, next),
      decideRoom: (room: ModelRoom, flag: string, verdict: "accept" | "dismiss") =>
        void handle.work.write(
          transitionPatches(
            ["decisions"],
            takeoffDecisionKey(room.guid, flag),
            {},
            {
              kind: "set",
              rung: { value: verdict },
            },
          ),
        ),
      // Flag stages the shape's cell; unflag unstages it (the old union could never unflag).
      flagReview: (key: string) => {
        if (review && handle.work.doc)
          void handle.work.write(takeoffFlagToggle(handle.work.doc, review.zone, key));
      },
    }),
    [
      handle.actions,
      handle.work,
      adoptPatches,
      adoptRows,
      review,
      stageEdit,
      setPage,
      setNavigation,
      world,
      page,
      navigation,
    ],
  );

  // THE FOUR CELL FAMILIES (the takeoffs cutover): each a trichotomy cell record, drawn through
  // the kit with the contract's transitions. An edit's edit rung needs its room's base (what
  // sync compares against), which only a person writes: a stage of an edit cell (typing, or
  // accepting Pea's suggestion) carries the base when the room has none yet.
  const doc = handle.work.doc;
  const cells = {
    edits: doc?.edits ?? {},
    adopt: doc?.adopt ?? {},
    decisions: doc?.decisions ?? {},
    reviewFlags: doc?.reviewFlags ?? {},
  };
  const wire = (segment: keyof typeof cells): CellWire => ({
    segment,
    revision: handle.work.revision,
    write: (patches, expectedRevision) =>
      handle.work.write(
        segment === "edits" && doc ? withEditBases(doc, authority, patches) : patches,
        expectedRevision,
      ),
  });
  const wires = {
    edits: wire("edits"),
    adopt: wire("adopt"),
    decisions: wire("decisions"),
    reviewFlags: wire("reviewFlags"),
  };

  return {
    handle,
    nativeObservation,
    cells,
    wires,
    savedCapture: capture,
    displayedCapture: capture ?? nativeCapture,
    source: capture ? ("saved" as const) : ("live" as const),
    target:
      handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
        ? JSON.stringify({ kind: "open", ref: handle.resolution.target.ref })
        : (options.target ?? ""),
    readOnly: capture !== undefined,
    world,
    snapshot,
    adoptRows,
    /** Why the pane has no rows: the candidates read is in flight or failed (its own words). */
    candidatesReading: candidatesCall.pending,
    candidatesIssue: candidatesCall.error ?? null,
    atlasRows: rows,
    syncPlan: plan,
    review,
    entity,
    edit,
    busy: handle.busy,
    failure: handle.failure,
    // Page state, flattened: every view reads one route-owned name.
    selection: { zones: page.zones, r10: page.r10 },
    views: page.views,
    zones: page.zones,
    r10Path: page.r10,
    stage: page.stage,
    zoneKey: navigation.zone,
    level: navigation.level,
    cursor: navigation.room,
    viewport: page.viewport,
    setViewport: (viewport: PlaneViewport | null, history: "push" | "replace") =>
      setPage({ viewport }, { history }),
    decisions: decisions,
    panel: page.panel,
    syncReview: page.syncReview,
    actions,
  };
}

export type EmbeddedTakeoffsController = ReturnType<typeof useTakeoffsController>;
export type TakeoffsController = EmbeddedTakeoffsController | import("./store").TakeoffStore;
