import { refusalOf } from "@pe/web-kernel/route/typed-route";
import { useContext, useState } from "react";
import { AttentionDocument, elementKey, useAttention } from "@pe/kit/lang/attention";
import { type Mark } from "@pe/agent-contracts";
import { Ladder } from "#/route/ladder";
import type { RoomsContext } from "./route";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { cardsMarkdown, coverage, newestRun, type Card } from "./cards";
import { cardLine, FeedbackCard } from "./card";
import type { RoomsPage } from "./page";

import { RoomsProvider, useRoomsWorkspace } from "./workspace";
import { RoomsSketch, type Drop } from "./sketch";
import { snapPlan } from "./snap";
import { RoomsPlan } from "./plan";
import { RoomsTable } from "./table";
import "./layout.css";

// The picture frame is the picture slot's render (scene/picture), not the kernel's layout (slice 8).
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";

type Body = {
  ctx: RoomsContext;
  page: RoomsPage;
  verbs: (row: { kind?: string; id?: string }) => React.ReactNode;
};

export function ScopeBody() {
  const { page, snapshot, pending, error, document, view, viewMissing, setPage } =
    useRoomsWorkspace();
  const levels = snapshot?.levels ?? [];
  const level =
    levels.find((item) => item.views.some((plan) => plan.id === view)) ??
    levels.find((item) => item.name === page.level);
  const note = !document
    ? "choose a document first"
    : error
      ? `rooms.snapshot failed: ${error}`
      : pending
        ? "reading rooms…"
        : "this document has no levels with plan views";
  return (
    <>
      {snapshot?.unreadable?.map((blob, index) => (
        <OutcomeLine
          key={index}
          kind="refused"
          label="can't read, kept"
          says={`${blob.parameter} / ${blob.elementId == null ? "Project Information" : "Element name unavailable"}: ${blob.reason}`}
        />
      ))}
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
            pick: (id) => {
              const next = levels.find((item) => item.name === id);
              if (!next) return;
              const single = next.views.length === 1 ? next.views[0] : undefined;
              setPage({
                level: id,
                view: next.views.some((plan) => plan.id === view) ? view : (single?.id ?? null),
                selected: [],
                viewport: null,
              });
            },
          },
          {
            key: "view",
            label: level?.views.find((plan) => plan.id === view)?.name ?? null,
            placeholder: "choose a plan view",
            options: level
              ? level.views.map((plan) => ({
                  id: String(plan.id),
                  label: plan.name,
                  sub: plan.type,
                }))
              : null,
            note: level ? "this level has no plan views" : "choose a level first",
            picked: (id) => id === String(view),
            pick: (id) => setPage({ view: Number(id), selected: [], viewport: null }),
          },
        ]}
      />
      {viewMissing ? (
        <ButtonGroup label="Plan view unavailable">
          <OutcomeLine kind="refused" label="plan view" says="That view is not in this document." />
          <Button
            label="Clear plan view"
            onClick={() => setPage({ view: null, selected: [], viewport: null })}
          >
            Clear plan view
          </Button>
        </ButtonGroup>
      ) : null}
    </>
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

function PlanBody({ ctx, page, verbs, renderPane }: Body & { renderPane: TeachingPaneRender }) {
  const {
    onView,
    regions,
    snapshot,
    empty,
    cards,
    labels,
    view,
    plan,
    planError,
    trace,
    setPage,
    selected,
    pinned,
    pin: setPinned,
  } = useRoomsWorkspace();
  const level =
    snapshot?.levels.find((item) => item.views.some((plan) => plan.id === view))?.name ?? "";
  const onDrop = async (drop: Drop) => {
    if (!snapshot || view === null) return "Choose a plan view first";
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
              : selected.includes(guid)
                ? selected.filter((item) => item !== guid)
                : [...selected, guid],
        });
      }}
      trace={trace}
      page={ctx.page}
      viewLabel={
        snapshot?.levels.flatMap((item) => item.views).find((plan) => plan.id === view)?.name
      }
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
              />
            )
          : undefined
      }
    />
  );
}

function AttentionRoomsSketch(props: Omit<React.ComponentProps<typeof RoomsSketch>, "hovered">) {
  const doc = useContext(AttentionDocument)!;
  const { hovered } = useAttention(doc);
  const region = props.regions.find((region) => hovered.has(elementKey(region.uniqueId)));
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
  const { page, selected, work, snapshot, view } = useRoomsWorkspace();
  const [said, setSaid] = useState<string | null>(null);
  const say = (word: string) => {
    setSaid(word);
    setTimeout(() => setSaid(null), 1500);
  };
  const body = {
    ctx,
    page,
    verbs: (row: { kind?: string; id?: string }) =>
      row.kind === "merge" && row.id ? (
        <Button
          label="Stage marked room merge"
          onClick={() => {
            const mark = ctx.cells.doc?.marks[row.id!]?.edit?.value;
            if (mark?.kind === "merge" && mark.anchor.view !== null)
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
  const frame: TeachingPaneRender = (content) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{content}</div>
  );
  const stage = async (key: string, input: unknown) =>
    ctx.cells.patch([{ path: ["writeIntent", key], value: { edit: { value: input } } }], {
      label: `Choose ${key} scope`,
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--gutter)">
      <div className="shrink-0 p-(--gutter)">
        <ScopeBody />
        {/* One row with one gap token that truncates (L3): the bare verbs ran together. */}
        <ButtonGroup label="Rooms verbs">
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
            refusal={!view ? "Choose a level and plan view" : refusalOf(ctx.cells.state)}
            onClick={() => {
              const rejected = Object.values(ctx.cells.doc?.marks ?? {}).flatMap((cell) =>
                cell.edit?.value?.kind === "reject" && cell.edit.value.anchor.view === view
                  ? [cell.edit.value.anchor.polygon]
                  : [],
              );
              void stage("rooms.partition", {
                view,
                ...(rejected.length ? { rejected } : {}),
              });
            }}
          >
            Stage partition view
          </Button>
          <Button
            label="Stage selected room merge"
            refusal={
              !view
                ? "Choose a level and plan view"
                : selected.length < 2
                  ? "Select two or more rooms"
                  : refusalOf(ctx.cells.state)
            }
            onClick={() => void stage("rooms.merge", { view, guids: selected })}
          >
            Stage room merge
          </Button>
          {/* The inbox list is the kernel's goal pane; its two exports are verbs, so they sit with the verbs. */}
          <Button
            label="copy markdown"
            kind="framed"
            reason="Copies every mark on this document as markdown, for Claude or Pea"
            refusal={work && snapshot ? null : "The rooms are not read yet"}
            onClick={() =>
              void navigator.clipboard.writeText(cardsMarkdown(work!.doc, snapshot!)).then(
                () => say("copied"),
                () => say("copy refused"),
              )
            }
          >
            {said === "copied" || said === "copy refused" ? said : "copy markdown"}
          </Button>
          <Button
            label="snap PNG"
            kind="framed"
            reason="Downloads the plan as drawn now, callouts and marks included"
            onClick={() =>
              void snapPlan(String(view ?? "")).then((missing) => say(missing ?? "saved"))
            }
          >
            {said && said !== "copied" && said !== "copy refused" ? said : "snap PNG"}
          </Button>
        </ButtonGroup>
      </div>
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-(--gutter) @min-[1100px]:grid-cols-2 @min-[1100px]:grid-rows-1">
          <PlanBody {...body} renderPane={frame} />
          <div data-rooms-regions="" className="flex min-h-0 min-w-0 flex-col">
            <RegionsBody {...body} />
          </div>
        </div>
      </div>
    </div>
  );
}
