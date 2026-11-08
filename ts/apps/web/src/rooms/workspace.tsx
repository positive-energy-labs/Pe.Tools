import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useValue } from "@pe/kit/lang/collection";
import { inboxCards } from "./cards";
import { roomsPageSchema, type RoomsPage } from "./page";
import type { RoomsContext } from "./route";
import { type TraceRead } from "./layers";
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

/** Domain projection only; pane providers belong to the shell. */
export function RoomsProvider({ctx,children}:{ctx:RoomsContext;children:ReactNode}) {
  const value=useWorkspace(ctx);
  return <Workspace value={value}>{children}</Workspace>;
}
