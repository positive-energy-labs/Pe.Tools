/**
 * Proportions with an honest legend. Segments spend the viz ladder by index (`viz: 1..6`), never a
 * meaning role; width, order and the legend carry meaning, colour only speeds it up. An empty
 * denominator renders nothing: the caller owns its EmptyState.
 */
import { token } from "../../lib/token";
import { tv } from "../../lib/tv";

import "./lang.css";
import { TooltipHint } from "./tooltip";

export const coverageBarRecipe = tv({
  slots: {
    base: "",
    bar: "flex h-2.5 overflow-hidden border border-line",
    segment: "border-r border-on",
    rest: "",
    legend: "mt-1 flex flex-wrap gap-x-3 gap-y-0.5",
    key: "inline-flex items-center gap-1 t-small face-mono text-ink",
    dot: "inline-block size-[7px] rounded-[1px]",
    label: "text-ink-2",
    total: "text-ink-2",
  },
});

export interface CoverageSegment {
  label: string;
  count: number;
  /** Viz-ladder rung. Indexed, not named: 1..6. */
  viz: 1 | 2 | 3 | 4 | 5 | 6;
}

export function CoverageBar({
  segments,
  total,
}: {
  segments: readonly CoverageSegment[];
  /** Denominator; defaults to the segment sum. A shortfall renders as an unaccounted tail. */
  total?: number;
}) {
  const sum = segments.reduce((acc, s) => acc + s.count, 0);
  const denom = total ?? sum;
  if (denom <= 0) return null;
  const {
    base,
    bar,
    segment,
    rest,
    legend,
    key,
    dot,
    label,
    total: totalSlot,
  } = coverageBarRecipe();
  return (
    <div className={base()}>
      <div className={bar()}>
        {segments.map((s) => (
          <TooltipHint content={`${s.label}: ${s.count}`} key={s.label}>
            <div
              className={segment()}
              style={{
                width: `${(s.count / denom) * 100}%`,
                backgroundColor: `color-mix(in srgb, ${token(`viz-${s.viz}`)} 55%, transparent)`,
              }}
            />
          </TooltipHint>
        ))}
        {sum < denom && (
          <TooltipHint content={`unaccounted: ${denom - sum}`}>
            <div
              data-surface="recess"
              className={rest()}
              style={{ width: `${((denom - sum) / denom) * 100}%` }}
            />
          </TooltipHint>
        )}
      </div>
      <div className={legend()}>
        {segments.map((s) => (
          <span key={s.label} className={key()}>
            <span className={dot()} style={{ backgroundColor: token(`viz-${s.viz}`) }} />
            <span className={label()}>{s.label}</span> {s.count}
          </span>
        ))}
        {typeof total === "number" && <span className={totalSlot()}>of {total}</span>}
      </div>
    </div>
  );
}
