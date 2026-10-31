import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RoomsRouteDocument } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { AttentionScope } from "#/attention";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import type { GraphMount } from "#/shell/mount";
import { readingValue } from "./actions";
import { inboxCards } from "./cards";
import type { RoomsPage } from "./graph";
import { railsOf, type TraceRead } from "./layers";
import { roomRows } from "./table";
import type { PlanReading } from "./sources";

export type RoomsOwner = GraphMount<RoomsPage, RoomsRouteDocument>;
const Workspace = createContext<ReturnType<typeof useWorkspace> | null>(null);
export const useRoomsWorkspace = () => useContext(Workspace)!;

function useWorkspace(owner: RoomsOwner) {
  const page = owner.view.read().page;
  const fixture = !!owner.fixture;
  const view = page.view;
  const state = owner.readings.get("snapshot");
  const snapshot = readingValue<RoomsSnapshot.Res.Response>(state);
  const error = state.status === "failed" ? (state.error ?? "unknown error") : null;
  const pending = state.status === "pending" || state.status === "stale";
  const doc = owner.snapshot().target;
  const document = doc.kind === "document" ? doc.ref : null;
  const work = owner.snapshot().work;
  const levelNames = useMemo(
    () =>
      [...(snapshot?.levels ?? [])]
        .sort((a, b) => a.elevation - b.elevation)
        .map((item) => item.name),
    [snapshot],
  );
  const rows = useMemo(() => roomRows(snapshot?.regions ?? [], levelNames), [snapshot, levelNames]);
  const onView = useMemo(() => rows.filter((row) => row.region.view === view), [rows, view]);
  const regions = useMemo(
    () => onView.map((row) => row.region).filter((region) => region.role !== "zone"),
    [onView],
  );
  const cards = useMemo(
    () => (work && snapshot && view ? inboxCards(work.doc, snapshot, view) : []),
    [work, snapshot, view],
  );
  const labels = useMemo(() => new Map(rows.map((row) => [row.region.guid, row.label])), [rows]);
  const traceState = owner.readings.get("trace");
  const trace = readingValue<TraceRead>(traceState) ?? { data: null, none: null };
  const planState = owner.readings.get("plan");
  const plan = readingValue<Exclude<PlanReading, null>>(planState);
  const empty = fixture
    ? null
    : !document
      ? { says: "no document bound", exit: "choose a document in the sentence" }
      : error
        ? { says: `rooms.snapshot failed: ${error}`, exit: "refresh once the host answers" }
        : !snapshot
          ? { says: "reading rooms…", exit: "wait for the snapshot" }
          : !view
            ? { says: "no plan view chosen", exit: "choose a level and a view" }
            : null;
  return {
    owner,
    page,
    view,
    fixture,
    snapshot,
    error,
    pending,
    document,
    work,
    rows,
    onView,
    regions,
    cards,
    labels,
    trace: {
      ...trace,
      ...(traceState.status === "failed"
        ? { none: `rooms.trace failed: ${traceState.error}` }
        : {}),
    },
    plan,
    planError: planState.status === "failed" ? (planState.error ?? "unknown error") : null,
    empty,
  };
}

/** Shared projections only: the graph and kernel own acquisition, writes, verbs and layout. */
export function RoomsProvider({ owner, children }: { owner: RoomsOwner; children: ReactNode }) {
  const value = useWorkspace(owner);
  const selection = useMemo(
    () =>
      Atom.make(
        (get): ReadonlySet<SubjectKey> =>
          new Set<SubjectKey>(
            get(owner.view.state).page.selected.map((guid): SubjectKey => `room:${guid}`),
          ),
      ),
    [owner],
  );
  const members = useMemo(
    () =>
      new Map(
        value.snapshot?.regions.map((region): [SubjectKey, SubjectKey[]] => [
          `room:${region.guid}`,
          [elementKey(region.elementId)],
        ]) ?? [],
      ),
    [value.snapshot],
  );
  const observation = useMemo<NativeObservation>(
    () => ({
      scope: {
        document: value.fixture || !value.snapshot ? null : value.document,
        source: value.fixture ? "fixture" : "native",
      },
      references: [
        ...(value.snapshot?.regions ?? []).map((region) => ({ elementId: region.elementId })),
        ...(value.trace.data
          ? railsOf(value.trace.data).map((rail) => ({ elementId: rail.elementId }))
          : []),
      ],
    }),
    [value.fixture, value.document, value.snapshot, value.trace.data],
  );
  const attentionDoc = value.document
    ? `${value.document.session}/${value.document.openId}`
    : "fixture:rooms:plan";
  return (
    <RegistryContext value={owner.registry}>
      <Workspace value={value}>
        <AttentionScope doc={attentionDoc} selected={selection} members={members}>
          <NativeObservationScope value={observation}>{children}</NativeObservationScope>
        </AttentionScope>
      </Workspace>
    </RegistryContext>
  );
}
