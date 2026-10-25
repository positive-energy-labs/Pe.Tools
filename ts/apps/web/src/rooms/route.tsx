import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { AttentionScope } from "#/attention";
import {
  AttentionDocument,
  elementKey,
  useAttention,
  type SubjectKey,
} from "@pe/kit/lang/attention";
import { listOf } from "@pe/kit/lang/collection";
/**
 * /rooms — the Situation over one level's plan view and its Room Regions. The sentence names the
 * document, the level and the view; the body is the plan beside the table, or the route's
 * receipts in History. The snapshot is one host read keyed on the target and `page.epoch`.
 */
import { useContext, useEffect, useMemo, useRef } from "react";
import {
  transitionPatches,
  type ActionReceipt,
  type Mark,
  type Reading,
  type RoomsNote,
  type RoomsRouteDocument,
} from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import type { CellWire } from "#/components/work/band";
import { EmptyState } from "@pe/kit/lang/empty";
import { List } from "@pe/kit/lang/list-popup";
import { Pane } from "@pe/kit/lang/pane";
import { PaneSplit } from "@pe/kit/lang/pane-resize";
import { Surface } from "@pe/kit/lang/surface";
import { useHostCall } from "#/readings";
import { callHostRpc } from "#/host/client";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { usePlanImage } from "#/takeoff/plan-image";
import type { Point2 } from "#/lib/affine-frame";
import type { ActionHandle } from "#/route/handle";
import { cardsMarkdown, coverage, inboxCards, newestRun, type Card } from "./cards";
import { cardLine, cardMoves, FeedbackCard, RoomsInbox } from "./inbox";
import { manifest, type RoomsPage } from "./manifest";
import { RoomsSketch, type Drop } from "./sketch";
import { snapPlan } from "./snap";
import { NO_TRACE, type TraceRead } from "./layers";
import { focusOf, RoomsPlan, type RoomsPlanLease } from "./plan";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { railsOf } from "./layers";
import { useRouteDemo } from "#/route/activity";
import { DEMO_VIEW, DEMO_ROOMS, DEMO_PLAN, DEMO_TRACE } from "./demo";
import { roomRows, RoomsTable } from "./table";

type Empty = { says: string; exit: string };

/**
 * `rooms.snapshot` from the one document the sentence names. Fetch on target (kaitpw, 2026-09-26):
 * it is read again when a view is targeted and when the window takes focus back (from Revit), as
 * well as after every verb (the epoch); the plan image keys on its view only.
 */
function useRoomsSnapshot(
  doc: { session: string; openId: string } | null,
  view: string,
  epoch: number,
) {
  const call = useHostCall(
    (signal) =>
      callHostRpc(
        "rooms.snapshot",
        {},
        {
          bridgeSessionId: doc!.session,
          openDocumentId: doc!.openId,
          signal,
        },
      ),
    ["rooms.snapshot", doc?.session, doc?.openId, epoch],
    doc !== null,
  );
  // `refresh` keeps the data on screen while the new read runs; a changed dep would blank it.
  const { refresh } = call;
  const targeted = useRef(view);
  useEffect(() => {
    if (targeted.current === view) return;
    targeted.current = view;
    refresh();
  }, [view, refresh]);
  useEffect(() => {
    if (doc === null) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [doc, refresh]);
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
  const call = useHostCall(
    (signal) =>
      callHostRpc(
        "rooms.trace",
        { view },
        {
          bridgeSessionId: doc!.session,
          openDocumentId: doc!.openId,
          signal,
        },
      ),
    ["rooms.trace", doc?.session, doc?.openId, view, epoch],
    doc !== null && view !== "",
  );
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

/** `url` is false in a chat pane, which does not own the URL; `focus` is a Page key either way. */
export function RoomsRoute({ url = true }: { url?: boolean } = {}) {
  const demo = useRouteDemo() === "plan";
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  const handle = useRoute(manifest, { target: chosen, thread, url });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const reading = useRoomsSnapshot(demo ? null : doc, page.view, page.epoch);
  const { snapshot, error, pending } = demo
    ? { snapshot: DEMO_ROOMS, error: null, pending: false }
    : reading;
  useEffect(() => {
    if (demo && !page.view) setPage({ view: DEMO_VIEW }, { history: "replace" });
  }, [demo, page.view, setPage]);
  const plan = usePlanImage(handle.resolution, page.view || undefined, PLAN_PX);
  const trace = useRoomsTrace(demo ? null : doc, page.view, page.epoch);
  const snapshotToken = useMemo(() => crypto.randomUUID(), [snapshot]);
  const lease: RoomsPlanLease = {
    thread,
    ready: !!snapshot && !pending && !error,
    context: {
      source: demo ? "fixture" : "native",
      document: demo ? null : doc,
      acquiredEpoch: page.epoch,
      snapshotToken,
      stage: page.stage,
      view: page.view,
      work: handle.work.key,
      workRevision: handle.work.revision,
    },
  };
  const nativeObservation = useMemo<NativeObservation>(
    () => ({
      scope: { document: demo || !snapshot ? null : doc, source: demo ? "fixture" : "native" },
      references: [
        ...(snapshot?.regions ?? []).map((region) => ({ elementId: region.elementId })),
        ...(trace.data ? railsOf(trace.data).map((rail) => ({ elementId: rail.elementId })) : []),
      ],
    }),
    [demo, doc, snapshot, trace.data],
  );
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "fixture:rooms:plan";
  const selection = useMemo(
    () =>
      Atom.make(
        (get): ReadonlySet<SubjectKey> =>
          new Set<SubjectKey>(
            get(handle.pageState).page.selected.map((guid): SubjectKey => `room:${guid}`),
          ),
      ),
    [handle.pageState],
  );
  const members = useMemo(
    () =>
      new Map(
        snapshot?.regions.map((region): [SubjectKey, SubjectKey[]] => [
          `room:${region.guid}`,
          [elementKey(region.elementId)],
        ]) ?? [],
      ),
    [snapshot],
  );

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
              setPage({ view: views[0] ?? "", selected: [], viewport: null });
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
            pick: (id) => setPage({ view: id, selected: [], viewport: null }),
          },
        ]}
        disabled={handle.busy !== null}
      />
      .
    </>
  );

  const empty: Empty | null = demo
    ? null
    : !doc
      ? { says: "no document bound", exit: "choose a document in the sentence" }
      : error
        ? { says: `rooms.snapshot failed: ${error}`, exit: "refresh once the host answers" }
        : !snapshot
          ? { says: "reading rooms…", exit: "wait for the snapshot" }
          : !page.view
            ? { says: "no plan view chosen", exit: "choose a level and a view in the sentence" }
            : null;

  return (
    <RegistryContext value={handle.registry}>
      <AttentionScope doc={attentionDoc} selected={selection} members={members}>
        <NativeObservationScope value={nativeObservation}>
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
                lease={lease}
                snapshot={snapshot}
                empty={empty}
                page={page}
                setPage={setPage}
                focus={page.focus}
                plan={demo ? { ...plan, image: { plan: DEMO_PLAN }, error: null } : plan}
                trace={demo ? DEMO_TRACE : trace}
                doc={handle.work.doc}
                wire={{
                  segment: "edits",
                  revision: handle.work.revision,
                  write: handle.work.write,
                }}
                applyMark={handle.actions.applyMark}
              />
            )}
          </Surface>
        </NativeObservationScope>
      </AttentionScope>
    </RegistryContext>
  );
}

function RoomsBody({
  lease,
  snapshot,
  empty,
  page,
  setPage,
  focus,
  plan,
  trace,
  doc,
  wire,
  applyMark,
}: {
  lease: RoomsPlanLease;
  snapshot: RoomsSnapshot.Res.Response | null;
  empty: Empty | null;
  page: RoomsPage;
  setPage: (next: Partial<RoomsPage>, move?: { history: "push" | "replace" }) => void;
  focus: string;
  plan: ReturnType<typeof usePlanImage>;
  trace: TraceRead;
  doc: RoomsRouteDocument | null;
  wire: CellWire;
  applyMark: ActionHandle;
}) {
  const fixture = useRouteDemo() === "plan";
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
    if (!focus) {
      applied.current = "";
      return;
    }
    if (!focused.rows.length || applied.current === focus) return;
    applied.current = focus;
    setPage({ view: focused.rows[0]!.region.view, selected: zoomTo });
  }, [focused, focus, zoomTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const image = plan.image && "plan" in plan.image ? plan.image.plan : null;
  const refusal = plan.image && "refusal" in plan.image ? plan.image.refusal : null;

  // Feedback: the inbox and the plan's marks read one derived list; the pin is the only local state.
  const review = page.stage === "review";
  const pinned = page.card || null;
  const setPinned = (id: string | null) => setPage({ card: id ?? "" });
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
    <Pane title="regions" meta={snapshot ? `${rows.length}` : undefined} scroll="clip" flush>
      <RoomsTable
        rows={rows}
        cells={doc?.edits ?? {}}
        wire={wire}
        onSelect={(guids) => setPage({ selected: [...guids] })}
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
        <RoomsPlan
          fixture={fixture}
          lease={lease}
          rows={onView}
          plan={image}
          planRefusal={refusal}
          planError={plan.error}
          empty={empty}
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
          trace={trace}
          page={page}
          setPage={setPage}
          overlay={
            review
              ? (geo) => (
                  <AttentionRoomsSketch
                    geo={geo}
                    cards={cards}
                    regions={regions}
                    pinned={pinned}
                    setPinned={setPinned}
                    onClear={() => setPage({ selected: [] })}
                    card={card}
                    onDrop={onDrop}
                    onNote={onNote}
                  />
                )
              : undefined
          }
        />
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
                show={page.show}
                onShow={(show) => setPage({ show })}
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
  const source = listOf(receipts, (value) =>
    (value as readonly ActionReceipt[])
      .filter((receipt) => receipt.key.startsWith("rooms."))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
  return (
    <Pane title="history" meta={`${source.items.length}`}>
      <List<ActionReceipt>
        aria-label="rooms receipts"
        {...source}
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

function AttentionRoomsSketch(props: Omit<React.ComponentProps<typeof RoomsSketch>, "hovered">) {
  const doc = useContext(AttentionDocument)!;
  const { hovered } = useAttention(doc);
  const region = props.regions.find((region) => hovered.has(elementKey(region.elementId)));
  return <RoomsSketch {...props} hovered={region?.guid ?? null} />;
}
