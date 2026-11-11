import { revitTarget } from "@pe/kit/lang/revit-target";
/**
 * One feedback mark as a card on the plan: glyph, author, line, thumbnail and its verbs, each
 * naming its transition. The list of marks is the kernel's goal pane (`./goal.ts`); state is
 * `inboxCards`', derived on read.
 */
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import { Button } from "@pe/kit/lang/button";
import { tokenRef } from "@pe/kit/lib/token";
import { CARD_META, type Card, type CardState } from "./cards";
import { TooltipHint } from "@pe/kit/lang/tooltip";

type Region = RoomsSnapshot.Res.RoomsRegion;

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
  verbs: React.ReactNode;
  onClose?: () => void;
}) {
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
            {verbs}
            {onClose ? (
              <Button label="unpin" reason="unpin (Esc)" onClick={onClose}>
                ×
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
