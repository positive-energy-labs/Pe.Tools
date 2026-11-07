import type { RoomsContext } from "./route";
import { useValue } from "@pe/kit/lang/collection";
import { roomSelection } from "./selection";
import * as Atom from "effect/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RoomsRouteDocument } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { AttentionScope } from "#/attention";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import type { GraphMount } from "#/shell/mount";
import { readingValue } from "./value";
import { inboxCards } from "./cards";
import type { RoomsPage } from "./page";
import { railsOf, type TraceRead } from "./layers";
import { roomRows } from "./table";
import type { PlanReading } from "./plan-reading";

const Workspace = createContext<ReturnType<typeof useWorkspace> | null>(null);
export const useRoomsWorkspace = () => useContext(Workspace)!;

function useWorkspace(ctx: RoomsContext) {
  const page = {...ctx.page.read(),selected:ctx.page.read().picked,epoch:0};
  const fixture = false;
  const data=useValue(ctx.value);
  const view = page.view;
  const snapshot=data?.snapshot;
  const error=ctx.value.current?null:ctx.value.reason;
  const pending=ctx.value.status === "pending";
  const document=ctx.target?.kind === "document"?ctx.target.ref:null;
  const work=ctx.cells.doc?{doc:ctx.cells.doc}:null;
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
  const trace={data:data?.trace??null,none:data?.traceError??null};
  const plan=data?.plan;
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
    ctx,
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
    trace,
    plan,
    planError:data?.planError??null,
    empty,
  };
}

/** Domain projection only; the shell installs attention and native observation. */
export function RoomsProvider({ctx,children}:{ctx:RoomsContext;children:ReactNode}) {
  const value=useWorkspace(ctx);
  return <Workspace value={value}>{children}</Workspace>;
}
