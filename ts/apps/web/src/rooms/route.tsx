/**
 * /rooms — the Situation over one level's plan view and its Room Regions. The sentence names the
 * document, the level and the view; the body is the plan beside the table, or the route's
 * receipts in History. The snapshot is one host read keyed on the target and `page.epoch`.
 */
import { useEffect, useMemo, useState } from "react";
import type { ActionReceipt, Reading, RoomsRouteDocument } from "@pe/agent-contracts";
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
import { manifest, type RoomsPage } from "./manifest";
import { RoomsPlan } from "./plan";
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

export function RoomsRoute({
  view: urlView,
  setView,
}: {
  view: string;
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
  const plan = usePlanImage(handle.resolution, page.view || undefined);
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
          plan={plan}
          hovered={hovered}
          setHovered={setHovered}
          cells={handle.work.doc?.edits ?? {}}
          wire={{ segment: "edits", revision: handle.work.revision, write: handle.work.write }}
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
  plan,
  hovered,
  setHovered,
  cells,
  wire,
}: {
  snapshot: RoomsSnapshot.Res.Response | null;
  empty: Empty | null;
  page: RoomsPage;
  setPage: (next: Partial<RoomsPage>) => void;
  plan: ReturnType<typeof usePlanImage>;
  hovered: string | null;
  setHovered: (guid: string | null) => void;
  cells: RoomsRouteDocument["edits"];
  wire: CellWire;
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
  const image = plan.image && "plan" in plan.image ? plan.image.plan : null;
  const refusal = plan.image && "refusal" in plan.image ? plan.image.refusal : null;
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
            onSelect={(guid) => setPage({ selected: guid ? [guid] : [] })}
            onHover={setHovered}
          />
        </Pane>
      }
      end={
        <Pane
          kind="content"
          title="regions"
          meta={snapshot ? `${rows.length}` : undefined}
          scroll="clip"
          flush
        >
          <RoomsTable
            rows={rows}
            cells={cells}
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
