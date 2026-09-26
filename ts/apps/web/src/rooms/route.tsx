/**
 * /rooms — the Situation over one level's plan view and its Room Regions. The sentence names the
 * document, the level and the view; the body is the plan beside the table, or the route's
 * receipts in History. The snapshot is one host read keyed on the target and `page.epoch`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  transitionPatches,
  type ActionReceipt,
  type Mark,
  type Reading,
  type RoomsNote,
  type RoomsRouteDocument,
} from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import type { CellWire } from "#/components/lang/band";
import { EmptyState } from "#/components/lang/empty";
import { List } from "#/components/lang/list-popup";
import { OutcomeLine } from "#/components/lang/outcome";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import { Surface } from "#/components/lang/surface";
import { previousOf, useHostOp } from "#/readings";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { usePlanImage } from "#/takeoff/plan-image";
import type { Point2 } from "#/lib/affine-frame";
import type { ActionHandle } from "#/route/use-route";
import { cardsMarkdown, coverage, inboxCards, newestRun, type Card } from "./cards";
import { cardLine, cardMoves, FeedbackCard, RoomsInbox } from "./inbox";
import { manifest, type RoomsPage } from "./manifest";
import { RoomsSketch, type Drop } from "./sketch";
import { snapPlan } from "./snap";
import { layersOf, NO_TRACE, type Layer, type TraceRead } from "./layers";
import { focusOf, RoomsPlan } from "./plan";
import { roomRows, RoomsTable } from "./table";

type Empty = { says: string; exit: string };

/** `rooms.snapshot` from the one document the sentence names. */
function useRoomsSnapshot(doc: { session: string; openId: string } | null, epoch: number) {
  const call = useHostOp(
    "rooms.snapshot",
    {},
    {
      bridgeSessionId: doc?.session,
      openDocumentId: doc?.openId,
      enabled: doc !== null,
    },
  );
  // Every verb bumps the epoch on success; the snapshot is read again then.
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0) refresh();
  }, [epoch, refresh]);
  return { snapshot: call.data ?? null, error: call.error?.message ?? null, pending: call.pending };
}

/**
 * `rooms.trace` for one view: read once per target, view and epoch (every verb that dirties the
 * receipts bumps the epoch). No run on the view yet is an empty state, not an error.
 */
function useRoomsTrace(
  doc: { session: string; openId: string } | null,
  view: string,
  epoch: number,
): TraceRead {
  const call = useHostOp(
    "rooms.trace",
    { view },
    {
      bridgeSessionId: doc?.session,
      openDocumentId: doc?.openId,
      enabled: doc !== null && view !== "",
    },
  );
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0) refresh();
  }, [epoch, refresh]);
  const error = call.error?.message ?? null;
  return {
    data: call.data ?? null,
    none: !error
      ? null
      : NO_TRACE.test(error)
        ? "no trace for this view"
        : `rooms.trace failed: ${error}`,
  };
}

/** Revit's exporter clamps an image's long side to 8000 px; ask for all of it so zoom stays sharp. */
const PLAN_PX = 8000;

export function RoomsRoute({
  view: urlView,
  focus,
  layers,
  setLayers,
  setView,
}: {
  view: string;
  /** The URL's `focus`: region labels, comma separated. */
  focus: string;
  /** The URL's `layers`: solver layers, comma separated. */
  layers: string;
  setLayers: (next: string) => void;
  setView: (view: string) => void;
}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  const handle = useRoute(manifest, { target: chosen, thread, page: { view: urlView } });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const { snapshot, error, pending } = useRoomsSnapshot(doc, page.epoch);
  const plan = usePlanImage(handle.resolution, page.view || undefined, PLAN_PX);
  const trace = useRoomsTrace(doc, page.view, page.epoch);
  const [hovered, setHovered] = useState<string | null>(null);

  // The view is the URL's too, so a link lands on the same plan.
  useEffect(() => {
    if (page.view !== urlView) setView(page.view);
  }, [page.view]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = snapshot?.levels ?? [];
  const level = levels.find((item) => item.views.includes(page.view)) ?? null;
  const read = !doc
    ? "choose a document first"
    : error
      ? `rooms.snapshot failed: ${error}`
      : pending
        ? "reading rooms…"
        : "this document has no levels with plan views";

  const sentence = (
    <>
      on{" "}
      <Ladder
        levels={[
          ...ladder.levels,
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
            note: read,
            picked: (id) => id === level?.name,
            pick: (id) => {
              const views = levels.find((item) => item.name === id)?.views ?? [];
              setPage({ view: views[0] ?? "", selected: [] });
            },
          },
        ]}
        disabled={handle.busy !== null}
        caution={ladder.lost}
      />{" "}
      ·{" "}
      <Ladder
        levels={[
          {
            key: "view",
            label: page.view || null,
            placeholder: "choose a plan view",
            options: level ? level.views.map((view) => ({ id: view, label: view })) : null,
            note: level ? "this level has no plan views" : "choose a level first",
            picked: (id) => id === page.view,
            pick: (id) => setPage({ view: id, selected: [] }),
          },
        ]}
        disabled={handle.busy !== null}
      />
      .
    </>
  );

  const empty: Empty | null = !doc
    ? { says: "no document bound", exit: "choose a document in the sentence" }
    : error
      ? { says: `rooms.snapshot failed: ${error}`, exit: "refresh once the host answers" }
      : !snapshot
        ? { says: "reading rooms…", exit: "wait for the snapshot" }
        : !page.view
          ? { says: "no plan view chosen", exit: "choose a level and a view in the sentence" }
          : null;

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: ladder.sessionWord, document: ladder.docWord }}
              commit="apply"
              sentence={sentence}
              ledger={[
                [
                  "read",
                  error
                    ? "failed"
                    : snapshot
                      ? `epoch ${page.epoch}`
                      : pending
                        ? "reading"
                        : "none",
                ],
                ["view", page.view || "none"],
              ]}
            />
          }
        />
      }
    >
      {page.stage === "history" ? (
        <RoomsHistory receipts={handle.readings.receipts} />
      ) : (
        <RoomsBody
          snapshot={snapshot}
          empty={empty}
          page={page}
          setPage={setPage}
          focus={focus}
          plan={plan}
          trace={trace}
          layers={layersOf(layers)}
          setLayers={setLayers}
          hovered={hovered}
          setHovered={setHovered}
          doc={handle.work.doc}
          wire={{ segment: "edits", revision: handle.work.revision, write: handle.work.write }}
          applyMark={handle.actions.applyMark}
        />
      )}
    </Surface>
  );
}

function RoomsBody({
  snapshot,
  empty,
  page,
  setPage,
  focus,
  plan,
  trace,
  layers,
  setLayers,
  hovered,
  setHovered,
  doc,
  wire,
  applyMark,
}: {
  snapshot: RoomsSnapshot.Res.Response | null;
  empty: Empty | null;
  page: RoomsPage;
  setPage: (next: Partial<RoomsPage>) => void;
  focus: string;
  plan: ReturnType<typeof usePlanImage>;
  trace: TraceRead;
  layers: Layer[];
  setLayers: (next: string) => void;
  hovered: string | null;
  setHovered: (guid: string | null) => void;
  doc: RoomsRouteDocument | null;
  wire: CellWire;
  applyMark: ActionHandle;
}) {
  const levelNames = useMemo(
    () =>
      [...(snapshot?.levels ?? [])]
        .sort((a, b) => a.elevation - b.elevation)
        .map((item) => item.name),
    [snapshot],
  );
  const rows = useMemo(() => roomRows(snapshot?.regions ?? [], levelNames), [snapshot, levelNames]);
  const onView = useMemo(
    () => rows.filter((row) => row.region.view === page.view),
    [rows, page.view],
  );
  const selected = useMemo(() => new Set(page.selected), [page.selected]);
  // Focus selects its regions (and their view) once, when the snapshot first holds them.
  const focused = useMemo(() => focusOf(rows, focus), [rows, focus]);
  const zoomTo = useMemo(() => focused.rows.map((row) => row.region.guid), [focused]);
  const applied = useRef("");
  useEffect(() => {
    if (!focused.rows.length || applied.current === focus) return;
    applied.current = focus;
    setPage({ view: focused.rows[0]!.region.view, selected: zoomTo });
  }, [focused, focus, zoomTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const image = plan.image && "plan" in plan.image ? plan.image.plan : null;
  const refusal = plan.image && "refusal" in plan.image ? plan.image.refusal : null;

  // Feedback: the inbox and the plan's marks read one derived list; the pin is the only local state.
  const review = page.stage === "review";
  const [pinned, setPinned] = useState<string | null>(null);
  const cards = useMemo(
    () => (doc && snapshot && page.view ? inboxCards(doc, snapshot, page.view) : []),
    [doc, snapshot, page.view],
  );
  const labels = useMemo(() => new Map(rows.map((row) => [row.region.guid, row.label])), [rows]);
  const labelOf = (guid: string) => labels.get(guid);
  const regions = useMemo(
    () => onView.map((row) => row.region).filter((region) => region.role !== "zone"),
    [onView],
  );
  const level = snapshot?.levels.find((item) => item.views.includes(page.view))?.name ?? "";
  const newId = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-6)}`;
  const onDrop = async (drop: Drop) => {
    if (!snapshot) return "the snapshot is not read yet";
    const mark: Mark = {
      kind: drop.kind,
      anchor: { view: page.view, level, polygon: drop.polygon.map(([x, y]) => [x, y]) },
      run: newestRun(snapshot, page.view) ?? "none",
      guids: drop.kind === "reject" ? [drop.guid] : coverage(drop.polygon, regions),
    };
    const id = newId("m");
    const refused = await wire.write(
      transitionPatches(["marks"], id, {}, { kind: "stage", rung: { value: mark } }),
    );
    if (!refused) setPinned(id);
    return refused?.message ?? null;
  };
  const onNote = async ([x, y]: Point2, text: string) => {
    const note: RoomsNote = {
      anchor: { view: page.view, level, polygon: [[x, y]] },
      text,
      by: "person",
      at: new Date().toISOString(),
    };
    return (await wire.write([{ path: ["notes", newId("n")], value: note }]))?.message ?? null;
  };
  const apply = {
    refusal: (id: string) =>
      applyMark.refusal ??
      ((doc?.marks[id]?.staged?.value?.guids?.length ?? 0) < 2
        ? "the mark covers fewer than two regions"
        : null),
    run: async (id: string) => {
      const refused = await applyMark.run({ id });
      return refused ? { code: "refused", message: refused.message } : null;
    },
  };
  const card = (item: Card, live: boolean) => (
    <FeedbackCard
      card={item}
      line={cardLine(item, labelOf)}
      regions={regions}
      verbs={live ? cardMoves(item, wire, apply) : null}
      onClose={() => setPinned(null)}
    />
  );
  const regionsPane = (
    <Pane
      kind="content"
      title="regions"
      meta={snapshot ? `${rows.length}` : undefined}
      scroll="clip"
      flush
    >
      <RoomsTable
        rows={rows}
        cells={doc?.edits ?? {}}
        wire={wire}
        selected={selected}
        hovered={hovered}
        onSelect={(guids) => setPage({ selected: [...guids] })}
        onHover={setHovered}
        empty={
          empty ?? {
            says: "no zones or room regions in this document",
            exit: "draw a zone on the chosen view in Revit, then press partition",
          }
        }
      />
    </Pane>
  );

  return (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{ target: "end", defaultSize: 760, minSize: 420, persist: "pe.rooms.tableWidth" }}
      start={
        <Pane kind="visual" title="plan" meta={page.view || undefined} scroll="clip" flush>
          <RoomsPlan
            rows={onView}
            plan={image}
            planRefusal={refusal}
            planError={plan.error}
            empty={empty}
            selected={selected}
            hovered={hovered}
            zoomTo={zoomTo}
            focusMissing={snapshot ? focused.missing : []}
            onSelect={(guid, add) => {
              // A click on a room with cards pins its first; a click on ground unpins.
              if (!add)
                setPinned(guid ? (cards.find((c) => c.guids.includes(guid))?.id ?? null) : null);
              setPage({
                selected: !guid
                  ? []
                  : !add
                    ? [guid]
                    : selected.has(guid)
                      ? page.selected.filter((item) => item !== guid)
                      : [...page.selected, guid],
              });
            }}
            onHover={setHovered}
            trace={trace}
            layers={layers}
            setLayers={setLayers}
            overlay={
              review
                ? (geo) => (
                    <RoomsSketch
                      geo={geo}
                      cards={cards}
                      regions={regions}
                      hovered={hovered}
                      pinned={pinned}
                      setPinned={setPinned}
                      card={card}
                      onDrop={onDrop}
                      onNote={onNote}
                    />
                  )
                : undefined
            }
          />
        </Pane>
      }
      end={
        review ? (
          <PaneSplit
            axis="vertical"
            grow
            resize={{
              target: "start",
              defaultSize: 260,
              minSize: 120,
              persist: "pe.rooms.inboxHeight",
            }}
            start={
              <RoomsInbox
                cards={cards}
                regions={regions}
                labelOf={labelOf}
                pinned={pinned}
                onPin={setPinned}
                onHover={setHovered}
                markdown={() => (doc && snapshot ? cardsMarkdown(doc, snapshot) : "")}
                snap={() => snapPlan(page.view)}
              />
            }
            end={regionsPane}
          />
        ) : (
          regionsPane
        )
      }
    />
  );
}

/** History: this route's action receipts, newest first. */
function RoomsHistory({ receipts }: { receipts: Reading<unknown> }) {
  const all = (previousOf(receipts) as readonly ActionReceipt[] | undefined) ?? [];
  const rows = all
    .filter((receipt) => receipt.key.startsWith("rooms."))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <Pane kind="content" title="history" meta={`${rows.length}`}>
      {receipts.state === "failed" ? (
        <OutcomeLine kind="error" label="receipts unread" says={receipts.message} />
      ) : null}
      <List<ActionReceipt>
        aria-label="rooms receipts"
        items={rows}
        keyOf={(receipt) => receipt.id}
        labelOf={(receipt) => receipt.key}
        empty={
          <EmptyState story="scope" exit="partition or apply from the other stages">
            {receipts.state === "absent"
              ? "no document bound"
              : "no rooms actions on this document yet"}
          </EmptyState>
        }
        row={(receipt) => ({
          label: `${receipt.key} · ${receipt.state}`,
          sub: "error" in receipt ? String(receipt.error) : undefined,
          meta: <span className="face-mono">{receipt.startedAt}</span>,
          failed: receipt.state === "failed" || receipt.state === "unknown",
        })}
      />
    </Pane>
  );
}
