import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useValue } from "@pe/kit/lang/collection";
import { inboxCards } from "./cards";
import { roomsPageSchema, type RoomsPage } from "./page";
import { useAdmittedSubject } from "#/shell/subject";
import { regionOf } from "./rows";
import { regionSubject } from "./subject";
import type { RoomsContext } from "./route";
import { type TraceRead } from "./layers";
import { levelOrder, roomRows } from "./rows";

const Workspace = createContext<ReturnType<typeof useWorkspace> | null>(null);
export const useRoomsWorkspace = () => useContext(Workspace)!;

function useWorkspace(ctx: RoomsContext) {
  const value = ctx.value;
  const data = useValue(value);
  const raw = ctx.page.read();
  const door = useAdmittedSubject();
  const all = data?.snapshot.regions ?? [];
  // The subject is the open rooms (ADR 0035 rule 1); the drawing reads their carrier GUIDs.
  const selected =
    raw.room.kind === "all" ? all.map((region) => region.guid) : raw.room.ids.flatMap((id) => regionOf(id) ?? []);
  const page = roomsPageSchema.parse({ ...raw, selected });
  const setPage = (patch: Partial<RoomsPage>) => {
    const { view, selected, ...pose } = patch;
    if (view !== undefined) ctx.page.query({ view });
    if (selected !== undefined) door?.select((selected === "all" ? [] : selected).map(regionSubject));
    // A new pick or view lets go of the pinned mark; the picked rooms' first mark shows instead.
    ctx.page.pose({ ...pose, ...(selected !== undefined || view !== undefined ? { card: "" } : {}) });
  };
  const view = page.view;
  const snapshot = data?.snapshot ?? null;
  const error =
    !value.current && value.status !== "pending" ? (value.reason ?? "Read failed") : null;
  const pending = value.status === "pending";
  const document = ctx.target?.kind === "document" ? ctx.target.ref : null;
  const work = data?.handle ? { doc: data.roomsWork, handle: data.handle } : null;
  const levelNames = useMemo(() => levelOrder(snapshot?.levels ?? []), [snapshot]);
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
  // The pinned mark: the one the address names, else the first that concerns a picked room.
  const pinned =
    (cards.find((card) => card.id === raw.card) ??
      cards.find((card) => card.guids.some((guid) => selected.includes(guid))))?.id ?? null;
  const pin = (id: string | null) => {
    const card = cards.find((item) => item.id === id);
    if (card) door?.select(card.guids.map(regionSubject));
    else if (!id) door?.clear();
    ctx.page.pose({ card: id ?? "" });
  };
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
    selected,
    pinned,
    pin,
    labels,
    trace,
    plan,
    planError: data?.planError ?? error,
    empty,
  };
}

/** Domain projection only; pane providers belong to the shell. */
export function RoomsProvider({ctx,children}:{ctx:RoomsContext;children:ReactNode}) {
  const value=useWorkspace(ctx);
  return <Workspace value={value}>{children}</Workspace>;
}
