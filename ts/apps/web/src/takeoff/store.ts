import { useMemo } from "react";
import {
  stagedAdoptChoices,
  stagedDecisions,
  stagedReviewFlags,
  stagedTakeoffEdits,
  takeoffDecisionAddress,
  type Reading,
  type TakeoffSnapshot,
  type TakeoffObservation,
  type TakeoffsRouteDocument,
  type PlaneViewport,
  type TargetResolution,
  type CandidateRegion,
} from "@pe/agent-contracts";
import type { GraphMount } from "#/shell/mount";
import type { CellWire } from "#/components/work/band";
import { takeoffGraph, type TakeoffGraphPage } from "./graph";
import { captureOf, valueOf, type TakeoffScope } from "./graph-actions";
import {
  adoptDrafts,
  atlasRows,
  EMPTY_WORLD,
  roomEdit,
  stagedModel,
  type AdoptDraft,
} from "./projections";
import { snapshotOfObservation, syncPlan } from "./actions";
import type { ModelRoom, RoomEdit } from "./world";
import type { NativeObservation } from "#/revit/observation";

export type TakeoffMount = GraphMount<TakeoffGraphPage, TakeoffsRouteDocument>;
/** The Atlas consumes this projection; the kernel owns reads, writes, reviews and revision history. */
export function useTakeoffStore(owner: TakeoffMount) {
  const scope: TakeoffScope = {
    ...owner.snapshot(),
    page: owner.view.read().page,
    readings: Object.fromEntries(
      Object.keys(takeoffGraph.readings).map((id) => [id, owner.readings.get(id)]),
    ),
  };
  const { page, work, target } = scope;
  const capture = captureOf(scope);
  const savedCapture = page.work ? capture : undefined;
  const authority = capture?.snapshot.world ?? EMPTY_WORLD;
  const doc = work?.doc;
  const edit = useMemo(() => (doc ? stagedTakeoffEdits(doc) : {}), [doc]);
  const decisions = useMemo(() => (doc ? stagedDecisions(doc) : {}), [doc]);
  const world = useMemo(
    () => stagedModel(authority, savedCapture ? {} : edit),
    [authority, edit, savedCapture],
  );
  const adoption = doc ? stagedAdoptChoices(doc) : {};
  const candidates = valueOf<CandidateRegion[]>(scope, "candidates");
  const adoptRows = candidates ? adoptDrafts(candidates, adoption) : null;
  const read = scope.readings.snapshot!;
  const observation = valueOf<TakeoffObservation>(scope, "snapshot");
  const previous = snapshotOfObservation(observation);
  const snapshot: Reading<TakeoffSnapshot> = savedCapture
    ? { state: "ready", observation: savedCapture.snapshot }
    : read.status === "failed" || observation?.kind === "failed"
      ? {
          state: "failed",
          message:
            read.error ?? (observation?.kind === "failed" ? observation.error : "Reading failed"),
          previous,
        }
      : previous
        ? read.current && observation?.kind === "ready"
          ? { state: "ready", observation: previous }
          : { state: "stale", previous, reason: "dirtied" }
        : read.status === "pending"
          ? { state: "loading", requestId: "takeoff-reading", deadline: Infinity }
          : { state: "absent" };
  const resolution: TargetResolution =
    target.kind === "document" ? { kind: "resolved", target } : { kind: "checking" };
  const nativeObservation = useMemo<NativeObservation>(
    () => ({
      scope: {
        document: savedCapture ? null : (capture?.provenance.target ?? null),
        source: savedCapture ? "saved" : "native",
      },
      references: authority.zones.flatMap((zone) => [
        { elementId: zone.zone.elementId },
        ...zone.rooms.map((room) => ({ elementId: room.elementId })),
      ]),
    }),
    [authority, capture, savedCapture],
  );
  const run = (id: string, input?: unknown) => owner.control(id, input).run();
  const wire = (segment: string): CellWire => ({
    segment,
    revision: work?.handle.revision ?? null,
    write: async (patches, expectedRevision = work?.handle.revision ?? -1) => {
      const result = await run("edit", { patches, expectedRevision });
      return "refusal" in result ? result.refusal : null;
    },
  });
  const navigation = (patch: Partial<TakeoffGraphPage>) =>
    owner.view.setPage(patch, { history: "push" });
  const zone = world.zones.find((zone) => zone.zone.guid === page.zone);
  const review = zone?.savedReview
    ? {
        zone: zone.zone.guid,
        data: zone.savedReview,
        flags: doc ? (stagedReviewFlags(doc)[zone.zone.guid] ?? []) : [],
        source: "saved native" as const,
      }
    : null;
  const actions = {
    partition: () => void run("partition"),
    chooseViews: (views: readonly string[]) => {
      const allowed = new Set(
        world.zones
          .filter((zone) => views.includes(zone.zone.lane.view))
          .map((zone) => zone.zone.guid),
      );
      navigation({
        views,
        zones: page.zones.filter((zone) => allowed.has(zone)),
        level: "",
        zone: "",
        room: "",
        viewport: null,
      });
    },
    chooseZones: (zones: readonly string[]) =>
      owner.view.setPage({
        zones,
        ...(page.zone && !zones.includes(page.zone) ? { zone: "", room: "" } : {}),
      }),
    chooseR10: (r10: string) => owner.view.setPage({ r10 }),
    chooseStage: (stage: TakeoffGraphPage["stage"]) => owner.view.setPage({ stage }),
    chooseLevel: (level: string) => navigation({ level, zone: "", room: "" }),
    chooseZone: (zone: string | null, level?: string) =>
      navigation({
        zone: zone ?? "",
        room: "",
        ...(level === undefined ? {} : { level }),
        ...(zone && !page.zones.includes(zone) ? { zones: [zone] } : {}),
      }),
    chooseRoom: (room: string | null, level?: string) =>
      navigation({ room: room ?? "", ...(level === undefined ? {} : { level }) }),
    focusRoom: (zone: string, room: string, level: string) =>
      navigation({ zone, room, level, ...(!page.zones.includes(zone) ? { zones: [zone] } : {}) }),
    clearRoomScope: () => navigation({ zone: "", room: "" }),
    patchAdopt: (
      view: string,
      elementId: number,
      next: Partial<Pick<AdoptDraft, "checked" | "name" | "systemTag">>,
    ) => {
      const row = adoptRows?.find((row) => row.view === view && row.region.elementId === elementId);
      if (row)
        void run("adoption", {
          key: `${view}:${elementId}`,
          choice: { checked: row.checked, name: row.name, systemTag: row.systemTag, ...next },
        });
    },
    patchRoom: (id: string, next: RoomEdit) => void run("room", { id, next }),
    decideRoom: (room: ModelRoom, flag: string, verdict: "accept" | "dismiss") =>
      void run("decide", { room: room.guid, flag, verdict }),
    flagReview: (shape: string) => void run("flag", { zone: page.zone, shape }),
  };
  return {
    owner,
    scope,
    page,
    work,
    handle: {
      resolution,
      demo: false,
      thread: undefined,
      registry: owner.registry,
      pageState: owner.view.state,
      page: [page, owner.view.setPage] as const,
      work: { key: work?.handle.key, revision: work?.handle.revision ?? null },
    },
    nativeObservation,
    cells: {
      edits: doc?.edits ?? {},
      adopt: doc?.adopt ?? {},
      decisions: doc?.decisions ?? {},
      reviewFlags: doc?.reviewFlags ?? {},
    },
    wires: {
      edits: wire("edits"),
      adopt: wire("adopt"),
      decisions: wire("decisions"),
      reviewFlags: wire("reviewFlags"),
    },
    savedCapture,
    displayedCapture: capture,
    source: page.work ? ("saved" as const) : ("live" as const),
    target: target.kind === "document" ? JSON.stringify({ kind: "open", ref: target.ref }) : "",
    readOnly: !!page.work,
    world,
    snapshot,
    adoptRows,
    candidatesReading: scope.readings.candidates?.status === "pending",
    candidatesIssue: scope.readings.candidates?.error
      ? new Error(scope.readings.candidates.error)
      : null,
    atlasRows: atlasRows(world, decisions),
    syncPlan: syncPlan(authority, page.zones, edit, decisions),
    review,
    entity: (id: string) => {
      const room = authority.zones.flatMap((zone) => zone.rooms).find((room) => room.guid === id);
      const pending = edit[id];
      return {
        bound: room !== undefined && room.elementId !== null,
        decided: Object.keys(decisions).some((key) => takeoffDecisionAddress(key).roomGuid === id),
        edit: pending ?? null,
        dirty: !!pending,
        conflict:
          !!pending && !!room && JSON.stringify(pending.base) !== JSON.stringify(roomEdit(room)),
      };
    },
    edit,
    busy: owner.busy(),
    failure: null,
    selection: { zones: page.zones, r10: page.r10 },
    views: page.views,
    zones: page.zones,
    r10Path: page.r10,
    stage: page.stage,
    zoneKey: page.zone || null,
    level: page.level,
    cursor: page.room || null,
    viewport: page.viewport,
    setViewport: (viewport: PlaneViewport | null, history: "push" | "replace") =>
      owner.view.setPage({ viewport }, { history }),
    decisions,
    actions,
  };
}
export type TakeoffStore = ReturnType<typeof useTakeoffStore>;
