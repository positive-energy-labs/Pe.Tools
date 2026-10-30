import { useContext, useEffect, useMemo, useRef } from "react";
import { AttentionDocument, elementKey, useAttention } from "@pe/kit/lang/attention";
import {
  transitionPatches,
  type ActionReceipt,
  type Mark,
  type RoomsNote,
  type RoomsRouteDocument,
} from "@pe/agent-contracts";
import { EmptyState } from "@pe/kit/lang/empty";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import type { CellTransition } from "@pe/kit/lang/cell";
import { Ladder } from "#/route/ladder";
import { useRouteThread } from "#/route/shell";
import type { CellWire } from "#/components/work/band";
import { mountRoute, routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { cardsMarkdown, coverage, newestRun, type Card } from "./cards";
import { cardLine, FeedbackCard, RoomsInbox } from "./inbox";
import { roomsGraph, type RoomsPage } from "./graph";
import { readingValue, roomsBinding, roomsWorkRefusal } from "./actions";
import { roomsSources } from "./sources";
import { RoomsProvider, useRoomsWorkspace, type RoomsOwner } from "./workspace";
import { RoomsSketch, type Drop } from "./sketch";
import { snapPlan } from "./snap";
import { focusOf, RoomsPlan } from "./plan";
import { RoomsTable } from "./table";
import type { Point2 } from "#/lib/affine-frame";

type Body = MountBody<RoomsPage, RoomsRouteDocument>;
const refusalOf = (result: Awaited<ReturnType<ReturnType<RoomsOwner["control"]>["run"]>>) =>
  "refusal" in result ? result.refusal : null;

function ScopeBody({ owner, page }: Body) {
  const { snapshot, pending, error, document, view } = useRoomsWorkspace();
  const levels = snapshot?.levels ?? [];
  const level = levels.find((item) => item.views.includes(view));
  const note = !document
    ? "choose a document first"
    : error
      ? `rooms.snapshot failed: ${error}`
      : pending
        ? "reading rooms…"
        : "this document has no levels with plan views";
  return (
    <Ladder
      disabled={owner.busy() !== null}
      levels={[
        {
          key: "level",
          label: level?.name ?? null,
          placeholder: "choose a level",
          options: snapshot
            ? levels.map((item) => ({
                id: item.name,
                label: item.name,
                sub: `${item.views.length} view${item.views.length === 1 ? "" : "s"}`,
              }))
            : null,
          note,
          picked: (id) => id === level?.name,
          pick: (id) =>
            owner.view.setPage({
              view: levels.find((item) => item.name === id)?.views[0] ?? "",
              selected: [],
              viewport: null,
            }),
        },
        {
          key: "view",
          label: view || null,
          placeholder: "choose a plan view",
          options: level ? level.views.map((id) => ({ id, label: id })) : null,
          note: level ? "this level has no plan views" : "choose a level first",
          picked: (id) => id === page.view,
          pick: (id) => owner.view.setPage({ view: id, selected: [], viewport: null }),
        },
      ]}
    />
  );
}

/** Rendering adapters invoke graph verbs; the kernel keeps each accepted Work inverse. */
function workWire(owner: RoomsOwner): CellWire {
  const revision = owner.snapshot().work?.handle.revision ?? null;
  return {
    segment: "edits",
    revision,
    write: async (patches, expectedRevision = revision ?? -1) =>
      refusalOf(await owner.control("edit", { patches, expectedRevision }).run()),
  };
}
function cellTransitions(owner: RoomsOwner, key: string): CellTransition[] {
  const row = { segment: "edits", key };
  return (
    [
      ["take", "take"],
      ["unsuggest", "reject"],
      ["clear", "reopen"],
    ] as const
  ).flatMap(([kind, verb]) => {
    const control = owner.control(`cell:edits.${verb}`, row);
    return control.refusal ? [] : [{ kind, run: async () => refusalOf(await control.run()) }];
  });
}
function RegionsBody({ owner }: Body) {
  const { work, rows, empty } = useRoomsWorkspace();
  return (
    <RoomsTable
      rows={rows}
      cells={work?.doc.edits ?? {}}
      wire={workWire(owner)}
      transitions={(key) => cellTransitions(owner, key)}
      onSelect={(guids) => owner.view.setPage({ selected: [...guids] })}
      empty={
        empty ?? {
          says: "no zones or room regions in this document",
          exit: "draw a zone on the chosen view in Revit, then press partition",
        }
      }
    />
  );
}

function PlanBody({ owner, page, verbs }: Body) {
  const {
    work,
    rows,
    onView,
    regions,
    snapshot,
    empty,
    cards,
    labels,
    view,
    fixture,
    plan,
    planError,
    trace,
    document,
    pending,
    error,
  } = useRoomsWorkspace();
  const thread = useRouteThread();
  const focused = useMemo(() => focusOf(rows, page.focus), [rows, page.focus]);
  const zoomTo = useMemo(() => focused.rows.map((row) => row.region.guid), [focused]);
  const applied = useRef("");
  useEffect(() => {
    if (!page.focus) {
      applied.current = "";
      return;
    }
    if (!focused.rows.length || applied.current === page.focus) return;
    applied.current = page.focus;
    owner.view.setPage({ view: focused.rows[0]!.region.view, selected: zoomTo });
  }, [owner, focused, page.focus, zoomTo]);
  useEffect(() => {
    if (fixture && !page.view) owner.view.setPage({ view }, { history: "replace" });
  }, [owner, fixture, page.view, view]);
  const token = useMemo(() => crypto.randomUUID(), [snapshot]);
  const selected = new Set(page.selected);
  const pinned = page.card || null;
  const setPinned = (id: string | null) => owner.view.setPage({ card: id ?? "" });
  const wire = workWire(owner);
  const level = snapshot?.levels.find((item) => item.views.includes(view))?.name ?? "";
  const onDrop = async (drop: Drop) => {
    if (!snapshot) return "the snapshot is not read yet";
    const mark: Mark = {
      kind: drop.kind,
      anchor: { view, level, polygon: drop.polygon.map(([x, y]) => [x, y]) },
      run: newestRun(snapshot, view) ?? "none",
      guids: drop.kind === "reject" ? [drop.guid] : coverage(drop.polygon, regions),
    };
    const id = `m${crypto.randomUUID()}`;
    const refusal = await wire.write(
      transitionPatches(["marks"], id, {}, { kind: "set", rung: { value: mark } }),
    );
    if (!refusal) setPinned(id);
    return refusal?.message ?? null;
  };
  const onNote = async ([x, y]: Point2, text: string) => {
    const note: RoomsNote = {
      anchor: { view, level, polygon: [[x, y]] },
      text,
      by: "person",
      at: new Date().toISOString(),
    };
    return (
      (await wire.write([{ path: ["notes", `n${crypto.randomUUID()}`], value: note }]))?.message ??
      null
    );
  };
  const card = (item: Card, live: boolean) => (
    <FeedbackCard
      card={item}
      line={cardLine(item, (guid) => labels.get(guid))}
      regions={regions}
      verbs={
        live
          ? verbs({
              id: item.id,
              kind: item.kind,
              segment: item.kind === "note" ? undefined : "marks",
              key: item.id,
            })
          : null
      }
      onClose={() => setPinned(null)}
    />
  );
  return (
    <RoomsPlan
      fixture={fixture}
      lease={{
        thread: thread ?? undefined,
        ready: !!snapshot && !pending && !error,
        context: {
          source: fixture ? "fixture" : "native",
          document: fixture ? null : document,
          acquiredEpoch: page.epoch,
          snapshotToken: token,
          stage: page.stage,
          view,
          work: work?.handle.key ?? null,
          workRevision: work?.handle.revision ?? null,
        },
      }}
      rows={onView}
      plan={plan && "plan" in plan ? plan.plan : null}
      planRefusal={plan && "refusal" in plan ? plan.refusal : null}
      planError={planError}
      empty={empty}
      zoomTo={zoomTo}
      focusMissing={snapshot ? focused.missing : []}
      onSelect={(guid, add) => {
        owner.view.setPage({
          ...(!add
            ? { card: guid ? (cards.find((c) => c.guids.includes(guid))?.id ?? "") : "" }
            : {}),
          selected: !guid
            ? []
            : !add
              ? [guid]
              : selected.has(guid)
                ? page.selected.filter((item) => item !== guid)
                : [...page.selected, guid],
        });
      }}
      trace={trace}
      page={{ ...page, view }}
      setPage={owner.view.setPage}
      overlay={
        page.stage === "review"
          ? (geo) => (
              <AttentionRoomsSketch
                geo={geo}
                cards={cards}
                regions={regions}
                pinned={pinned}
                setPinned={setPinned}
                onClear={() => owner.view.setPage({ selected: [] })}
                card={card}
                onDrop={onDrop}
                onNote={onNote}
              />
            )
          : undefined
      }
    />
  );
}

function FeedbackBody({ owner, page }: Body) {
  const { work, snapshot, cards, regions, labels, view } = useRoomsWorkspace();
  return (
    <RoomsInbox
      cards={cards}
      regions={regions}
      labelOf={(guid) => labels.get(guid)}
      pinned={page.card || null}
      onPin={(card) => owner.view.setPage({ card })}
      show={page.show}
      onShow={(show) => owner.view.setPage({ show })}
      markdown={() => (work && snapshot ? cardsMarkdown(work.doc, snapshot) : "")}
      snap={() => snapPlan(view)}
    />
  );
}

function HistoryBody({ owner }: Body) {
  const state = owner.readings.get("receipts");
  const receipts = (readingValue<ActionReceipt[]>(state) ?? [])
    .filter((receipt) => receipt.key.startsWith("rooms."))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const list = useList({
    items: receipts,
    keyOf: (receipt) => receipt.id,
    search: (receipt) => ({ text: [receipt.key, receipt.state] }),
  });
  if (!receipts.length)
    return (
      <EmptyState story="scope" exit="partition or apply from the other stages">
        {state.status === "failed"
          ? state.error
          : !owner.snapshot().work
            ? "no document bound"
            : "no rooms actions on this document yet"}
      </EmptyState>
    );
  return (
    <ListView
      list={list}
      aria-label="rooms receipts"
      empty={{ message: "No matching rooms actions", exit: "Clear the search" }}
      row={(receipt) => ({
        label: `${receipt.key} · ${receipt.state}`,
        sub: "error" in receipt ? String(receipt.error) : undefined,
        meta: <span className="face-mono">{receipt.startedAt}</span>,
        failed: receipt.state === "failed" || receipt.state === "unknown",
      })}
    />
  );
}

function AttentionRoomsSketch(props: Omit<React.ComponentProps<typeof RoomsSketch>, "hovered">) {
  const doc = useContext(AttentionDocument)!;
  const { hovered } = useAttention(doc);
  const region = props.regions.find((region) => hovered.has(elementKey(region.elementId)));
  return <RoomsSketch {...props} hovered={region?.guid ?? null} />;
}

export const roomsAdapters: RouteAdapters<RoomsPage, RoomsRouteDocument> = {
  sources: roomsSources(),
  binding: roomsBinding,
  cell: (row, scope) => {
    const value = row as { segment?: string; key?: string } | undefined;
    return value?.key &&
      (value.segment === "edits" || value.segment === "marks") &&
      scope.work &&
      !roomsWorkRefusal(scope)
      ? {
          type: `cell:${value.segment}`,
          id: value.key,
          work: scope.work.handle.key,
          path: [value.segment, value.key],
        }
      : null;
  },
  subjects: {},
  verbReadings: {},
  verbDepends: {
    partition: ["snapshot"],
    apply: ["snapshot"],
    merge: ["snapshot"],
    applyMark: ["snapshot"],
  },
  receiptPaths: (receipt) =>
    receipt.consumes.flatMap((input) => (input.kind === "work" ? [...input.probe.paths] : [])),
  wrap: (owner, children) => <RoomsProvider owner={owner}>{children}</RoomsProvider>,
  bodies: {
    scope: (body) => <ScopeBody {...body} />,
    plan: (body) => <PlanBody {...body} />,
    feedback: (body) => <FeedbackBody {...body} />,
    regions: (body) => <RegionsBody {...body} />,
    history: (body) => <HistoryBody {...body} />,
  },
};
export const roomsRoute = routeFromGraph(roomsGraph, roomsAdapters, "/rooms");
export const RoomsRoute = mountRoute(roomsGraph, roomsAdapters);
