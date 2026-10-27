import { useContext, useMemo } from "react";
import { AttentionDocument, useMembers, type SubjectKey } from "@pe/kit/lang/attention";
import { revitTarget } from "@pe/kit/lang/revit-target";
/**
 * The feedback inbox (V6 calm): one row per mark or note on the view, in `CARD_STATES` order. A
 * row points (hover pairs its region, click pins its card on the plan); verbs live on the card,
 * never the row, and each names its transition. State is `inboxCards`', derived on read.
 */
import { useState } from "react";
import {
  transitionBinding,
  transitionPatches,
  type RouteStatePatch,
  type TransitionKind,
} from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import type { CellWire } from "#/components/work/band";
import { useList, emptyListState } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";
import { Pane } from "@pe/kit/lang/pane";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { tokenRef } from "@pe/kit/lib/token";
import { CARD_META, CARD_STATES, type Card, type CardState } from "./cards";
import type { RoomsPage } from "./manifest";
import { TooltipHint } from "@pe/kit/lang/tooltip";

type Region = RoomsSnapshot.Res.RoomsRegion;
type Wire = Pick<CellWire, "write" | "revision">;
type Refusal = { code: string; message: string } | null;

/** A state's glyph in its tone; the title says what it means and what moves it next. */
function Glyph({ state }: { state: CardState }) {
  const meta = CARD_META[state];
  return (
    <TooltipHint content={meta.says}>
      <span data-tone={meta.tone ?? undefined} data-glyph={state}>
        {meta.glyph}
      </span>
    </TooltipHint>
  );
}

/** The author is a readable word; the card id stays in its facts. */
const Tag = ({ card }: { card: Card }) => (
  <TooltipHint content={card.by === "pea" ? "from Pea" : "from a person"}>
    <span className="face-mono">{card.by === "pea" ? "Pea" : "person"}</span>
  </TooltipHint>
);

/** The card's one line: kind, the regions it concerns by their table labels, area, text. */
export const cardLine = (card: Card, labelOf: (guid: string) => string | undefined) =>
  [
    card.kind,
    card.guids.map((guid) => labelOf(guid) ?? guid.slice(0, 8)).join(", ") || null,
    card.sqft >= 1 ? `${card.sqft.toFixed(0)} sf` : null,
    card.text || null,
  ]
    .filter(Boolean)
    .join(" · ");

// ponytail: outline thumbnail, image crop later
/** Region outlines near the card's anchor plus its polygon, model feet, y up. No plan image. */
function Thumb({
  card,
  regions,
  width,
}: {
  card: Card;
  regions: readonly Region[];
  width: number;
}) {
  const own = regions.filter((r) => card.guids.includes(r.guid));
  const points = [...card.polygon, ...own.flatMap((r) => r.outer)];
  const xs = points.map((p) => p[0] ?? 0);
  const ys = points.map((p) => p[1] ?? 0);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.22 + 4;
  const box = [x0 - pad, -(y1 + pad), x1 - x0 + 2 * pad, y1 - y0 + 2 * pad] as const;
  const near = regions.filter((r) =>
    r.outer.some(
      ([x = 0, y = 0]) => x > box[0] && x < box[0] + box[2] && -y > box[1] && -y < box[1] + box[3],
    ),
  );
  const ring = (loop: readonly (readonly number[])[]) =>
    `M${loop.map((p) => `${p[0]} ${p[1]}`).join("L")}Z`;
  const ink = tokenRef(CARD_META[card.state].tone ?? "ink");
  return (
    <svg
      aria-hidden
      width={width}
      height={(width * 3) / 4}
      viewBox={box.join(" ")}
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform="scale(1,-1)">
        {near.map((r) => (
          <path
            key={r.guid}
            d={ring(r.outer)}
            fill="none"
            stroke={tokenRef("ink-mute")}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {card.polygon.length > 2 ? (
          <path
            d={ring(card.polygon)}
            fill={ink}
            fillOpacity={0.25}
            stroke={ink}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <circle cx={card.polygon[0]![0]} cy={card.polygon[0]![1]} r={pad / 4} fill={ink} />
        )}
      </g>
    </svg>
  );
}

interface Verb {
  word: string;
  /** The transition it makes, from state to state, and what it writes. */
  title: string;
  refusal?: string | null;
  run: () => Promise<Refusal>;
}

/** A bound transition carries the rendered revision; with none rendered it refuses (band.tsx). */
const writeKind = (wire: Wire, kind: TransitionKind, patches: RouteStatePatch[]) =>
  transitionBinding(kind) !== "bound"
    ? wire.write(patches)
    : wire.revision === null
      ? Promise.resolve({ code: "not-ready", message: "Work has not been read yet" })
      : wire.write(patches, wire.revision);

/** The verbs a person has on one card, exactly as its rungs allow. */
export function cardMoves(
  card: Card,
  wire: Wire,
  apply: { refusal: (id: string) => string | null; run: (id: string) => Promise<Refusal> },
): Verb[] {
  const cell = card.cell;
  const at = `${card.kind === "note" ? "notes" : "marks"}/${card.id}`;
  const remove: Verb = {
    word: "delete",
    title: `${card.state} → removed: delete ${at} from the Work`,
    run: () => wire.write([{ path: [card.kind === "note" ? "notes" : "marks", card.id] }]),
  };
  if (!cell) return [remove];
  const move = (kind: TransitionKind) =>
    writeKind(wire, kind, transitionPatches(["marks"], card.id, cell, { kind } as never));
  if (!cell.edit)
    return [
      {
        word: "take",
        title: `proposed → accepted: stage Pea's mark (writes ${at}/edit)`,
        run: () => move("take"),
      },
      {
        word: "reject",
        title: `proposed → removed: drop Pea's suggestion (clears ${at}/suggestion)`,
        run: () => move("unsuggest"),
      },
    ];
  return [
    ...(card.kind === "merge"
      ? [
          {
            word: "apply",
            title: `${card.state} → merged: rooms.merge the regions it covers, then read the plan again`,
            refusal: apply.refusal(card.id),
            run: () => apply.run(card.id),
          },
        ]
      : []),
    ...(cell.suggestion
      ? [
          {
            word: "reopen",
            title: `${card.state} → proposed: unstage; Pea's suggestion stands (clears ${at}/edit)`,
            run: () => move("clear"),
          },
        ]
      : []),
    remove,
  ];
}

/** One card: glyph, tag, line, thumbnail and its verbs. The plan's projection draws it. */
export function FeedbackCard({
  card,
  line,
  regions,
  verbs,
  onClose,
}: {
  card: Card;
  line: string;
  regions: readonly Region[];
  verbs: readonly Verb[] | null;
  onClose?: () => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div
      className="flex gap-2 p-1"
      data-card={card.id}
      {...revitTarget(
        regions
          .filter((region) => card.guids.includes(region.guid))
          .map((region) => region.elementId),
      )}
    >
      <Thumb card={card} regions={regions} width={96} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex gap-1">
          <Glyph state={card.state} />
          <Tag card={card} />
        </span>
        <span>{line}</span>
        {verbs ? (
          <span className="flex flex-wrap items-center gap-1">
            {verbs.map((verb) => (
              <Button
                key={verb.word}
                label={verb.word}
                kind="framed"
                reason={verb.title}
                refusal={verb.refusal ? verb.refusal : null}
                onClick={() => void verb.run().then((refusal) => setSaid(refusal?.message ?? null))}
              >
                {verb.word}
              </Button>
            ))}
            {onClose ? (
              <Button label="unpin" reason="unpin (Esc)" onClick={onClose}>
                ×
              </Button>
            ) : null}
          </span>
        ) : null}
        {said ? (
          <span data-tone="alarm" className="t-small">
            {said}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type Filter = RoomsPage["show"];

/** The inbox pane: filter, rows, and the two exports (markdown to the clipboard, the plan PNG). */
export function RoomsInbox({
  cards,
  regions,
  labelOf,
  pinned,
  onPin,
  show: filter,
  onShow,
  markdown,
  snap,
}: {
  cards: readonly Card[];
  regions: readonly Region[];
  labelOf: (guid: string) => string | undefined;
  pinned: string | null;
  onPin: (id: string) => void;
  /** The state filter, held in the address beside the pinned card. */
  show: Filter;
  onShow: (show: Filter) => void;
  markdown: () => string;
  /** Downloads the plan picture; answers what it could not include, else null. */
  snap: () => Promise<string | null>;
}) {
  const attentionDoc = useContext(AttentionDocument) ?? "";
  const [said, setSaid] = useState<string | null>(null);
  const say = (word: string) => {
    setSaid(word);
    setTimeout(() => setSaid(null), 1500);
  };
  const count = (state: CardState) => cards.filter((card) => card.state === state).length;
  const shown = filter === "all" ? cards : cards.filter((card) => card.state === filter);
  useMembers(
    attentionDoc,
    useMemo(
      () =>
        new Map(
          cards.map((card) => [
            `card:${card.id}` as const,
            card.guids.map((guid): SubjectKey => `room:${guid}`),
          ]),
        ),
      [cards],
    ),
  );
  const list = useList({
    items: shown,
    subjectOf: (card) => ({ doc: attentionDoc, key: `card:${card.id}` }),
    keyOf: (card) => card.id,
    search: (card) => ({ text: [cardLine(card, labelOf), card.state] }),
    state: { ...emptyListState(), selected: pinned ? [pinned] : [] },
    onPick: (card) => onPin(card.id),
    select: "single",
  });
  return (
    <Pane
      title="Feedback"
      meta={said ?? `${cards.length}`}
      scroll="clip"
      flush
      actions={
        <>
          <Button
            label="copy markdown"
            kind="framed"
            reason="Copies every mark and note on this document as markdown, for Claude or Pea"
            onClick={() =>
              void navigator.clipboard.writeText(markdown()).then(
                () => say("copied"),
                () => say("copy refused"),
              )
            }
          >
            copy markdown
          </Button>
          <Button
            label="snap PNG"
            kind="framed"
            reason="Downloads the plan as drawn now, callouts and marks included"
            onClick={() => void snap().then((missing) => say(missing ?? "saved"))}
          >
            snap PNG
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-1 py-1">
          <Switcher<Filter>
            ariaLabel="filter Feedback by state"
            value={filter}
            onChange={onShow}
            options={[
              { value: "all", label: `all ${cards.length}`, title: "every card on this view" },
              ...CARD_STATES.filter((state) => count(state) > 0).map((state) => ({
                value: state,
                label: `${CARD_META[state].glyph}${count(state)}`,
                title: CARD_META[state].says,
              })),
            ]}
          />
        </div>
        <Scroll className="min-h-0 flex-1">
          <ListView
            list={list}
            aria-label="Feedback"
            empty={{
              message: cards.length ? "No card in this state" : "No marks or notes on this view",
              exit: cards.length
                ? "Choose all in the filter"
                : "Draw a mark or a note on the plan, or ask Pea",
            }}
            row={(card) => ({
              lead: (
                <span className="flex gap-1">
                  <Glyph state={card.state} />
                  <Tag card={card} />
                </span>
              ),
              revit: regions
                .filter((region) => card.guids.includes(region.guid))
                .map((region) => region.elementId),
              label: cardLine(card, labelOf),
              meta: <Thumb card={card} regions={regions} width={32} />,
            })}
          />
        </Scroll>
      </div>
    </Pane>
  );
}
