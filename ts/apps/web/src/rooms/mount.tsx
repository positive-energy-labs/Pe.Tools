import { roomSelection } from "./selection";
import { useContext } from "react";
import { AttentionDocument, elementKey, useAttention } from "@pe/kit/lang/attention";
import { type Mark, type RoomsNote } from "@pe/agent-contracts";
import { Ladder } from "#/route/ladder";
import type { RoomsContext } from "./route";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { cardsMarkdown, coverage, newestRun, type Card } from "./cards";
import { cardLine, FeedbackCard, RoomsInbox } from "./inbox";
import type { RoomsPage } from "./page";

import { RoomsProvider, useRoomsWorkspace } from "./workspace";
import { RoomsSketch, type Drop } from "./sketch";
import { snapPlan } from "./snap";
import { RoomsPlan } from "./plan";
import { RoomsTable } from "./table";
import type { Point2 } from "#/lib/affine-frame";

import type { PaneApi } from "../../../../packages/kit/src/components/lang/graph-layout";

type Body = {
  ctx: RoomsContext;
  page: RoomsPage;
  verbs: (row: { kind?: string; id?: string }) => React.ReactNode;
};

export function ScopeBody({ page }: Body) {
  const { snapshot, pending, error, document, view, setPage } = useRoomsWorkspace();
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
      disabled={!snapshot || !document}
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
            setPage({
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
          pick: (id) => setPage({ view: id, selected: [], viewport: null }),
        },
      ]}
    />
  );
}

function RegionsBody({ ctx }: Body) {
  const { rows, empty, setPage } = useRoomsWorkspace();
  return (
    <RoomsTable
      rows={rows}
      cells={ctx.cells}
      value={ctx.value}
      onSelect={(guids) => setPage({ selected: [...guids] })}
      empty={
        empty ?? {
          says: "no zones or room regions in this document",
          exit: "draw a zone on the chosen view in Revit, then press partition",
        }
      }
    />
  );
}

function PlanBody({ ctx, page, verbs, renderPane }: Body & { renderPane: PaneApi }) {
  const { onView, regions, snapshot, empty, cards, labels, view, plan, planError, trace, setPage } =
    useRoomsWorkspace();
  const selected = new Set(
    roomSelection(
      page.selected,
      cards,
      regions.map((region) => region.guid),
    ).guids,
  );
  const { pinned } = roomSelection(
    page.selected,
    cards,
    regions.map((region) => region.guid),
  );
  const setPinned = (id: string | null) => setPage({ selected: id ? [`card:${id}`] : [] });
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
    const refusal = await ctx.cells.at(["marks", id]).stage(mark, { label: "Mark room feedback" });
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
      (
        await ctx.cells.patch([{ path: ["notes", `n${crypto.randomUUID()}`], value: note }], {
          label: "Add room note",
        })
      )?.message ?? null
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
            })
          : null
      }
      onClose={() => setPinned(null)}
    />
  );
  return (
    <RoomsPlan
      renderPane={renderPane}
      rows={onView}
      plan={plan && "plan" in plan ? plan.plan : null}
      planRefusal={plan && "refusal" in plan ? plan.refusal : null}
      planError={planError}
      empty={empty}
      onSelect={(guid, add) => {
        setPage({
          selected: !guid
            ? []
            : !add
              ? [guid]
              : selected.has(guid)
                ? roomSelection(
                    page.selected,
                    cards,
                    regions.map((region) => region.guid),
                  ).guids.filter((item) => item !== guid)
                : [
                    ...roomSelection(
                      page.selected,
                      cards,
                      regions.map((region) => region.guid),
                    ).guids,
                    guid,
                  ],
        });
      }}
      trace={trace}
      page={ctx.page}
      value={ctx.value}
      overlay={
        page.stage === "review"
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
  );
}

function FeedbackBody({ page, renderPane }: Body & { renderPane: PaneApi }) {
  const { work, snapshot, cards, regions, labels, view, setPage } = useRoomsWorkspace();
  return (
    <RoomsInbox
      renderPane={renderPane}
      cards={cards}
      regions={regions}
      labelOf={(guid) => labels.get(guid)}
      pinned={
        roomSelection(
          page.selected,
          cards,
          regions.map((region) => region.guid),
        ).pinned
      }
      onPin={(card) => setPage({ selected: [`card:${card}`] })}
      show={page.show}
      onShow={(show) => setPage({ show })}
      markdown={() => (work && snapshot ? cardsMarkdown(work.doc, snapshot) : "")}
      snap={() => snapPlan(view)}
    />
  );
}

function AttentionRoomsSketch(props: Omit<React.ComponentProps<typeof RoomsSketch>, "hovered">) {
  const doc = useContext(AttentionDocument)!;
  const { hovered } = useAttention(doc);
  const region = props.regions.find((region) => hovered.has(elementKey(region.elementId)));
  return <RoomsSketch {...props} hovered={region?.guid ?? null} />;
}

export function RoomsBody({ ctx }: { ctx: RoomsContext }) {
  return (
    <RoomsProvider ctx={ctx}>
      <RoomsWorkspace ctx={ctx} />
    </RoomsProvider>
  );
}
function RoomsWorkspace({ ctx }: { ctx: RoomsContext }) {
  const { page, cards, regions } = useRoomsWorkspace();
  const selected = roomSelection(
    page.selected,
    cards,
    regions.map((region) => region.guid),
  ).guids;
  const body = {
    ctx,
    page,
    verbs: (row: { kind?: string; id?: string }) =>
      row.kind === "note" && row.id ? (
        <Button
          label="Delete room note"
          onClick={() =>
            void ctx.cells.patch([{ path: ["notes", row.id!] }], { label: "Delete room note" })
          }
        >
          Delete note
        </Button>
      ) : row.kind === "merge" && row.id ? (
        <Button
          label="Stage marked room merge"
          onClick={() => {
            const mark = ctx.cells.doc?.marks[row.id!]?.edit?.value;
            if (mark?.kind === "merge")
              void ctx.cells.patch(
                [
                  {
                    path: ["writeIntent", "rooms.merge"],
                    value: { edit: { value: { view: mark.anchor.view, guids: mark.guids ?? [] } } },
                  },
                ],
                { label: "Choose marked room merge" },
              );
          }}
        >
          Stage merge
        </Button>
      ) : null,
  } satisfies Body;
  const frame: PaneApi = (content) => <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
  const stage = async (key: string, input: unknown) =>
    ctx.cells.patch([{ path: ["writeIntent", key], value: { edit: { value: input } } }], {
      label: `Choose ${key} scope`,
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--gutter)">
      <div className="shrink-0 p-(--gutter)">
        <ScopeBody {...body} />
        <Switcher
          ariaLabel="Rooms view"
          value={ctx.page.read().stage}
          onChange={(stage) => ctx.page.pose({ stage })}
          options={[
            { value: "partition", label: "Partition", title: "Inspect and partition rooms" },
            { value: "review", label: "Review", title: "Review anchored feedback" },
          ]}
        />
        <Button
          label="Stage partition view"
          refusal={!page.view ? "Choose a level and plan view" : ctx.cells.refusal}
          onClick={() => {
            const rejected = Object.values(ctx.cells.doc?.marks ?? {}).flatMap((cell) =>
              cell.edit?.value?.kind === "reject" && cell.edit.value.anchor.view === page.view
                ? [cell.edit.value.anchor.polygon]
                : [],
            );
            void stage("rooms.partition", {
              view: page.view,
              ...(rejected.length ? { rejected } : {}),
            });
          }}
        >
          Stage partition view
        </Button>
        <Button
          label="Stage selected room merge"
          refusal={selected.length < 2 ? "Select two or more rooms" : ctx.cells.refusal}
          onClick={() => void stage("rooms.merge", { view: page.view, guids: selected })}
        >
          Stage room merge
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-(--gutter) min-[1100px]:grid-cols-2">
        <PlanBody {...body} renderPane={frame} />
        <div className="flex min-h-0 flex-col">
          <RegionsBody {...body} />
          <FeedbackBody {...body} renderPane={frame} />
        </div>
      </div>
    </div>
  );
}
