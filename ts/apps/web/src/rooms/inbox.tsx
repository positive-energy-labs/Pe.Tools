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

import type { CellWire } from "#/components/lang/band";
import { EmptyState } from "#/components/lang/empty";
import { List } from "#/components/lang/list-popup";
import { Pane } from "#/components/lang/pane";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { tokenRef } from "#/lib/token";
import { CARD_META, CARD_STATES, type Card, type CardState } from "./cards";

type Region = RoomsSnapshot.Res.RoomsRegion;
type Wire = Pick<CellWire, "write" | "revision">;
type Refusal = { code: string; message: string } | null;

/** A state's glyph in its tone; the title says what it means and what moves it next. */
function Glyph({ state }: { state: CardState }) {
  const meta = CARD_META[state];
  return (
    <span data-tone={meta.tone ?? undefined} data-glyph={state} title={meta.says}>
      {meta.glyph}
    </span>
  );
}

/** The card id, square-bracketed from Pea, round from a person. */
const Tag = ({ card }: { card: Card }) => (
  <span className="face-mono" title={card.by === "pea" ? "from Pea" : "from a person"}>
    {card.by === "pea" ? `[${card.id}]` : `(${card.id})`}
  </span>
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
  if (!cell.staged)
    return [
      {
        word: "accept",
        title: `proposed → accepted: stage Pea's mark (writes ${at}/staged)`,
        run: () => move("accept"),
      },
      {
        word: "reject",
        title: `proposed → removed: drop Pea's proposal (clears ${at}/proposal)`,
        run: () => move("deny"),
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
    ...(cell.proposal
      ? [
          {
            word: "reopen",
            title: `${card.state} → proposed: unstage; Pea's proposal stands (clears ${at}/staged)`,
            run: () => move("unstage"),
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
    <div className="flex gap-2 p-1" data-card={card.id}>
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
              <Press
                key={verb.word}
                frame="line"
                size="caption"
                title={verb.refusal ?? verb.title}
                disabled={!!verb.refusal}
                onClick={() => void verb.run().then((refusal) => setSaid(refusal?.message ?? null))}
              >
                {verb.word}
              </Press>
            ))}
            {onClose ? (
              <Press size="caption" tone="quiet" title="unpin (Esc)" onClick={onClose}>
                ×
              </Press>
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

type Filter = "all" | CardState;

/** The inbox pane: filter, rows, and the two exports (markdown to the clipboard, the plan PNG). */
export function RoomsInbox({
  cards,
  regions,
  labelOf,
  pinned,
  onPin,
  onHover,
  markdown,
  snap,
}: {
  cards: readonly Card[];
  regions: readonly Region[];
  labelOf: (guid: string) => string | undefined;
  pinned: string | null;
  onPin: (id: string) => void;
  onHover: (guid: string | null) => void;
  markdown: () => string;
  /** Downloads the plan picture; answers what it could not include, else null. */
  snap: () => Promise<string | null>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [said, setSaid] = useState<string | null>(null);
  const say = (word: string) => {
    setSaid(word);
    setTimeout(() => setSaid(null), 1500);
  };
  const count = (state: CardState) => cards.filter((card) => card.state === state).length;
  const shown = filter === "all" ? cards : cards.filter((card) => card.state === filter);
  return (
    <Pane
      kind="content"
      title="inbox"
      meta={said ?? `${cards.length}`}
      scroll="clip"
      flush
      actions={
        <>
          <Press
            frame="line"
            size="caption"
            title="Copies every mark and note on this document as markdown, for Claude or Pea"
            onClick={() =>
              void navigator.clipboard.writeText(markdown()).then(
                () => say("copied"),
                () => say("copy refused"),
              )
            }
          >
            copy markdown
          </Press>
          <Press
            frame="line"
            size="caption"
            title="Downloads the plan as drawn now, callouts and marks included"
            onClick={() => void snap().then((missing) => say(missing ?? "saved"))}
          >
            snap PNG
          </Press>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-1 py-1">
          <Switcher<Filter>
            ariaLabel="filter the inbox by state"
            value={filter}
            onChange={setFilter}
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
        <List<Card>
          aria-label="feedback inbox"
          items={shown}
          keyOf={(card) => card.id}
          labelOf={(card) => cardLine(card, labelOf)}
          onPick={(card) => onPin(card.id)}
          select="single"
          selected={pinned ? [pinned] : []}
          empty={
            <EmptyState
              story="scope"
              exit={
                cards.length
                  ? "choose all in the filter"
                  : "draw a mark or a note on the plan, or ask Pea"
              }
            >
              {cards.length ? "no card in this state" : "no marks or notes on this view"}
            </EmptyState>
          }
          row={(card) => ({
            lead: (
              <span className="flex gap-1">
                <Glyph state={card.state} />
                <Tag card={card} />
              </span>
            ),
            label: cardLine(card, labelOf),
            meta: <Thumb card={card} regions={regions} width={32} />,
            onMouseEnter: () => onHover(card.guids[0] ?? null),
            onMouseLeave: () => onHover(null),
          })}
        />
      </div>
    </Pane>
  );
}
