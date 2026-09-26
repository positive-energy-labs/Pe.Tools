/**
 * The plan's feedback layer (V6 calm): a tools bar with two marks and a note, the drawn marks,
 * one count badge per region with cards, and the card projected beside its room. A draft is
 * client-local until it drops; on drop it is staged. Escape cancels, `v` returns to look.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import type { Point2, Viewport2 } from "#/lib/affine-frame";
import { useScopeKeys } from "#/route/keys";
import { token } from "#/lib/token";
import { CARD_META, CARD_STATES, inLoop, rdp, shoelace, type Card, type CardState } from "./cards";
import { PIN_R } from "./callouts";
import type { RoomsRegion } from "./plan";

/** The plan's frame as the overlay needs it: model feet to screen px and back, and the pins. */
export interface PlanGeo {
  size: Viewport2;
  toScreen: (ft: Point2) => Point2;
  toFeet: (px: Point2) => Point2;
  /** Each drawn callout's pin, by region guid, in screen px. */
  pins: ReadonlyMap<string, Point2>;
}

type Tool = "look" | "merge" | "reject" | "note";
const TOOLS: { value: Tool; label: string; title: string }[] = [
  { value: "look", label: "look", title: "look: pan, hover and pin cards (v)" },
  {
    value: "merge",
    label: "◌ merge",
    title: "lasso the rooms to merge: the drop stages a merge mark on every region it half covers",
  },
  {
    value: "reject",
    label: "✗ reject",
    title: "click a region that is not a room: stages a reject mark; partition holds it `rejected`",
  },
  {
    value: "note",
    label: "✎ note",
    title: "click a place, then type: writes a note, never staged",
  },
];
/** RDP tolerance and the smallest lasso that is a mark (model feet, square feet). */
const SIMPLIFY_FT = 0.3;
const MIN_SF = 2;
const BADGE = { w: 26, h: 15 } as const;
const CARD_W = 300;

export type Drop =
  | { kind: "merge"; polygon: Point2[] }
  | { kind: "reject"; polygon: Point2[]; guid: string };

const ringD = (points: readonly Point2[]) => `M${points.map((p) => p.join(" ")).join("L")}Z`;
const ink = (state: CardState) => token(CARD_META[state].tone ?? "ink");
/** The host pans on pointer down and clears the selection on click; the overlay's own UI is not ground. */
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

export function RoomsSketch({
  geo,
  cards,
  regions,
  hovered,
  pinned,
  setPinned,
  card,
  onDrop,
  onNote,
}: {
  geo: PlanGeo;
  cards: readonly Card[];
  /** The view's regions, zones excluded: what reject clicks and badges sit on. */
  regions: readonly RoomsRegion[];
  hovered: string | null;
  pinned: string | null;
  setPinned: (id: string | null) => void;
  /** Draws one card; `live` = its verbs are pressable (pinned), else a hover glance. */
  card: (card: Card, live: boolean) => ReactNode;
  /** Stages the drawn mark; answers a refusal's sentence, else null. */
  onDrop: (drop: Drop) => Promise<string | null>;
  onNote: (point: Point2, text: string) => Promise<string | null>;
}) {
  const [tool, setTool] = useState<Tool>("look");
  const [draft, setDraft] = useState<Point2[] | null>(null);
  const [placing, setPlacing] = useState<Point2 | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  useScopeKeys([
    {
      hotkey: "Escape",
      label: "cancel or unpin",
      says: "cancel the mark or note being drawn, else unpin the card",
      options: { ignoreInputs: false },
      callback: () => {
        if (draft || placing) {
          setDraft(null);
          setPlacing(null);
        } else setPinned(null);
      },
    },
    {
      hotkey: "V",
      label: "look",
      says: "return the plan to the look tool",
      callback: () => {
        setTool("look");
        setDraft(null);
      },
    },
  ]);
  useEffect(() => noteRef.current?.focus(), [placing]);

  const at = (event: React.PointerEvent | React.MouseEvent): Point2 => {
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    return geo.toFeet([event.clientX - rect.left, event.clientY - rect.top]);
  };
  const land = (answer: Promise<string | null>) => void answer.then((refusal) => setSaid(refusal));

  const drop = () => {
    const points = draft ? rdp(draft, SIMPLIFY_FT) : [];
    setDraft(null);
    if (points.length < 3 || shoelace(points) < MIN_SF)
      return setSaid(`a merge lasso needs 3 or more points and ${MIN_SF} sf or more`);
    land(onDrop({ kind: "merge", polygon: points }));
  };
  const click = (point: Point2) => {
    if (tool === "note") return setPlacing(point);
    const region = regions.find((r) => inLoop(point[0], point[1], r.outer));
    if (!region) return setSaid("no region under that point");
    land(
      onDrop({
        kind: "reject",
        polygon: region.outer.map((p) => [p[0]!, p[1]!]),
        guid: region.guid,
      }),
    );
  };

  // What projects: the pinned card, else the hovered region's first card while looking.
  const shown =
    cards.find((c) => c.id === pinned) ??
    (tool === "look" && hovered ? cards.find((c) => c.guids.includes(hovered)) : undefined);
  const byRegion = new Map<string, Card[]>();
  for (const c of cards)
    for (const guid of c.guids) byRegion.set(guid, [...(byRegion.get(guid) ?? []), c]);
  const place = (points: readonly (readonly number[])[]) => {
    const px = points.map((p) => geo.toScreen([p[0]!, p[1]!]));
    const right = Math.max(...px.map((p) => p[0])) + 12;
    const top = Math.min(...px.map((p) => p[1]));
    return {
      left: right + CARD_W > geo.size.width ? Math.max(0, right - CARD_W - 24) : right,
      top: Math.min(Math.max(0, top), Math.max(0, geo.size.height - 140)),
    };
  };
  const { width, height } = geo.size;

  return (
    <>
      <svg
        width={width}
        height={height}
        data-layer="feedback"
        className="absolute top-0 left-0"
        style={{ pointerEvents: tool === "look" ? "none" : "auto", cursor: "crosshair" }}
        aria-label="feedback marks"
        onPointerDown={(event) => {
          event.stopPropagation();
          if (tool !== "merge" || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraft([at(event)]);
        }}
        onPointerMove={(event) => {
          if (draft) setDraft([...draft, at(event)]);
        }}
        onPointerUp={() => (draft ? drop() : undefined)}
        onClick={(event) => {
          event.stopPropagation();
          if (tool === "reject" || tool === "note") click(at(event));
        }}
      >
        {cards.map((c) => {
          const px = c.polygon.map((p) => geo.toScreen([p[0]!, p[1]!]));
          const color = ink(c.state);
          return c.polygon.length > 2 ? (
            <path
              key={c.id}
              data-mark={c.id}
              d={ringD(px)}
              fill="none"
              stroke={color}
              strokeWidth={c.id === pinned ? 3 : 2}
              className={c.state === "proposed" ? "dash-reference" : undefined}
            />
          ) : (
            <text key={c.id} x={px[0]![0]} y={px[0]![1]} fill={color} textAnchor="middle">
              {CARD_META.note.glyph}
            </text>
          );
        })}
        {[...byRegion].map(([guid, list]) => {
          const pin = geo.pins.get(guid);
          if (!pin) return null;
          const states = CARD_STATES.filter((s) => list.some((c) => c.state === s));
          let x = pin[0] - (states.length * BADGE.w) / 2;
          const y = pin[1] - PIN_R - BADGE.h - 2;
          return (
            <g key={guid} data-badge={guid}>
              {states.map((state) => {
                const n = list.filter((c) => c.state === state).length;
                const cell = (
                  <g key={state}>
                    <title>{CARD_META[state].says}</title>
                    <rect x={x} y={y} width={BADGE.w} height={BADGE.h} fill={ink(state)} />
                    <text
                      x={x + BADGE.w / 2}
                      y={y + BADGE.h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10.5}
                      fontFamily="var(--font-mono)"
                      fill={token("page")}
                    >
                      {`${CARD_META[state].glyph}${n}`}
                    </text>
                  </g>
                );
                x += BADGE.w;
                return cell;
              })}
            </g>
          );
        })}
        {draft ? (
          <polyline
            points={draft.map((p) => geo.toScreen(p).join(",")).join(" ")}
            fill="none"
            stroke={token("pea")}
            strokeWidth={2}
          />
        ) : null}
      </svg>
      <div
        className="absolute top-1 left-1 flex items-center gap-1"
        data-surface="page"
        onPointerDown={stop}
        onClick={stop}
      >
        <Switcher<Tool>
          ariaLabel="plan tool"
          value={tool}
          onChange={(next) => {
            setTool(next);
            setDraft(null);
            setPlacing(null);
            setSaid(null);
          }}
          options={TOOLS}
        />
        {said ? (
          <Press size="caption" tone="quiet" title="dismiss" onClick={() => setSaid(null)}>
            {said} ×
          </Press>
        ) : null}
      </div>
      {placing ? (
        <div
          className="absolute"
          data-surface="artifact"
          style={place([placing])}
          onPointerDown={stop}
          onClick={stop}
        >
          <input
            ref={noteRef}
            aria-label="note text"
            placeholder="note, Enter writes it"
            className="t-small px-1"
            onKeyDown={(event) => {
              const text = event.currentTarget.value.trim();
              if (event.key !== "Enter" || !text) return;
              land(onNote(placing, text));
              setPlacing(null);
            }}
          />
        </div>
      ) : shown ? (
        <div
          className="absolute"
          data-surface="artifact"
          data-projection={shown.id}
          style={{
            ...place(shown.polygon),
            width: CARD_W,
            pointerEvents: shown.id === pinned ? "auto" : "none",
          }}
          onPointerDown={stop}
          onClick={stop}
        >
          {card(shown, shown.id === pinned)}
        </div>
      ) : null}
    </>
  );
}
