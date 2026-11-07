import { roomSelection } from "./selection";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useValue } from "@pe/kit/lang/collection";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { AttentionScope } from "#/attention";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { inboxCards } from "./cards";
import { roomsPageSchema, type RoomsPage } from "./page";
import type { RoomsContext } from "./route";
import { railsOf, type TraceRead } from "./layers";
import { roomRows } from "./table";

const Workspace = createContext<ReturnType<typeof useWorkspace> | null>(null);
export const useRoomsWorkspace = () => useContext(Workspace)!;

function useWorkspace(ctx: RoomsContext) {
  const value = ctx.value;
  const data = useValue(value);
  const raw = ctx.page.read();
  const page = roomsPageSchema.parse({ ...raw, selected: raw.picked });
  // CHEAT: room selection still uses semantic guid/card keys; typed Page owns focus identities.
  const setPage = (patch: Partial<RoomsPage>) => {
    const { view, show, selected, epoch: _epoch, ...pose } = patch;
    if (view !== undefined) ctx.page.query({ view });
    if (show !== undefined) ctx.page.query({ show });
    ctx.page.pose({ ...pose, ...(selected !== undefined ? { picked: selected } : {}) });
  };
  const view = page.view;
  const snapshot = data?.snapshot ?? null;
  const error =
    !value.current && value.status !== "pending" ? (value.reason ?? "Read failed") : null;
  const pending = value.status === "pending";
  const document = ctx.target?.kind === "document" ? ctx.target.ref : null;
  const work = data?.handle ? { doc: data.roomsWork, handle: data.handle } : null;
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
  const trace: TraceRead = { data: data?.trace ?? null, none: data?.traceError ?? error };
  const plan = data?.plan ?? null;
  const empty = !document
    ? { says: "no document bound", exit: "choose a document in the sentence" }
    : error
      ? { says: `rooms.snapshot failed: ${error}`, exit: "refresh once the host answers" }
      : !snapshot
        ? { says: "reading rooms…", exit: "wait for the snapshot" }
        : !view
          ? { says: "no plan view chosen", exit: "choose a level and a view" }
          : null;
  return {
    ctx,
    value,
    page,
    setPage,
    view,
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
    trace,
    plan,
    planError: data?.planError ?? error,
    empty,
  };
}

/** CHEAT(K gap 4): app-owned selection/attention/native providers are not supplied by kit handles.
 * Domain projections use the accepted Value directly; no graph-shaped reading owner. */
export function RoomsProvider({ ctx, children }: { ctx: RoomsContext; children: ReactNode }) {
  const value = useWorkspace(ctx);
  const selection = useMemo(
    () =>
      Atom.make(
        (): ReadonlySet<SubjectKey> =>
          new Set<SubjectKey>(
            roomSelection(
              value.page.selected,
              value.cards,
              value.regions.map((region) => region.guid),
            ).guids.map((guid): SubjectKey => `room:${guid}`),
          ),
      ),
    [value.cards, value.page.selected, value.regions],
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
        document: !ctx.value.current || !value.snapshot ? null : value.document,
        source: "native",
      },
      references: [
        ...(value.snapshot?.regions ?? []).map((region) => ({ elementId: region.elementId })),
        ...(value.trace.data
          ? railsOf(value.trace.data).map((rail) => ({ elementId: rail.elementId }))
          : []),
      ],
    }),
    [ctx.value.current, value.document, value.snapshot, value.trace.data],
  );
  const attentionDoc = value.document
    ? `${value.document.session}/${value.document.openId}`
    : "fixture:rooms:plan";
  return (
    <Workspace value={value}>
      <AttentionScope doc={attentionDoc} selected={selection} members={members}>
        <NativeObservationScope value={observation}>{children}</NativeObservationScope>
      </AttentionScope>
    </Workspace>
  );
}
