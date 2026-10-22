import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * The drawing's key to its encoding: `Encoding` read into the kit's `Legend` (the look lives in
 * `@pe/kit/lang/legend`). A sequential scale is a band of its ramp with the breaks under it and the
 * group's max element named (a click selects it); line weight and categories are rows of their own
 * stroke with a count in this group. Missing values are a row, never left out.
 */
import { Legend, type LegendRow, type LegendStroke } from "@pe/kit/lang/legend";

import { DASH_CLASS, formatQuantity, type Encoding, type Stroke } from "../../encoding";

const strokeOf = (stroke: Stroke, arrow = false): LegendStroke => ({
  ink: stroke.ink,
  width: stroke.width,
  className: stroke.dash ? DASH_CLASS[stroke.dash] : undefined,
  arrow,
});

export function ScaleLegend({
  encoding,
  counts,
  nameOf,
  onSelect,
  className,
}: {
  encoding: Encoding;
  counts: ReadonlyMap<string, number>;
  nameOf: (id: number) => string | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const { quantity } = encoding;
  const ramp = Object.entries(encoding.bins).filter(([key]) => key !== "missing");
  const f = (n: number) => (quantity ? formatQuantity(quantity, n) : String(n));
  const gap = encoding.bins.missing;
  const gapCount = counts.get("missing") ?? 0;
  const foot =
    quantity && quantity.maxId != null && quantity.max != null ? (
      <span className="flex items-center gap-1 whitespace-nowrap" data-scale-max={quantity.maxId}>
        max <span className="face-mono">{f(quantity.max)}</span> {quantity.unit} at
        <TooltipHint content={`select ${nameOf(quantity.maxId) ?? "it"}`}>
          <button
            type="button"
            className="max-w-56 cursor-pointer truncate underline decoration-dotted underline-offset-2"
            onClick={() => onSelect(quantity.maxId!)}
          >
            {nameOf(quantity.maxId) ?? "an unnamed element"}
          </button>
        </TooltipHint>
      </span>
    ) : quantity ? (
      <span className="text-ink-2">no element in this system has a value</span>
    ) : null;
  const rows: LegendRow[] =
    encoding.kind === "plain"
      ? []
      : ramp.map(([key, bin]) => ({
          key,
          stroke: strokeOf(bin.stroke, encoding.kind === "flow" && key === "known"),
          word: bin.word,
          count: counts.get(key) ?? 0,
          says: bin.says,
        }));

  return (
    <Legend
      className={className}
      reading={encoding.key}
      label={encoding.label}
      unit={quantity?.unit}
      says={encoding.says}
      ramp={
        encoding.kind === "sequential"
          ? {
              steps: ramp.map(([key, bin]) => ({
                key,
                ink: bin.stroke.ink,
                says: `${bin.word}: ${counts.get(key) ?? 0} elements`,
              })),
              breaks:
                quantity && quantity.min != null && quantity.max != null
                  ? [quantity.min, ...quantity.edges, quantity.max].map(f)
                  : [],
            }
          : undefined
      }
      rows={rows}
      plain={
        encoding.kind === "plain"
          ? "no reading: pick one above the drawing's right edge"
          : undefined
      }
      missing={
        gapCount && gap
          ? {
              key: "missing",
              stroke: strokeOf(gap.stroke),
              word: "no value",
              count: gapCount,
              says: gap.says,
            }
          : null
      }
      foot={foot}
    />
  );
}
