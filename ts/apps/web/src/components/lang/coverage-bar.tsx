/**
 * COVERAGE BAR — proportions with an honest legend; THE viz ladder's first catalogued
 * consumer (design-lang.css: "--viz-* … governed by the grayscale law (from ops CoverageBar,
 * this palette's first shipped consumer)").
 *
 * CONSUMERS: src/ops/views/detail/parameter-coverage.tsx, src/lab/glance/** and the design-system specimen.
 *
 * RULINGS EMBODIED:
 * - Segments spend the VIZ ladder by INDEX (`viz: 1..6`), never a meaning role and never a
 *   named hue — a viz colour asserts "different from its neighbours" and nothing else.
 * - THE GRAYSCALE LAW: width, order and the legend (label + count) carry the meaning; colour
 *   only speeds it up. That is why the legend is not optional.
 * - An empty denominator renders NOTHING here: the caller owns its EmptyState, because only
 *   the caller knows the exit ("run a read", "widen the scope") — a primitive cannot.
 */
import { token } from "#/lib/token";
import { tv } from "#/lib/tv";

import "./lang.css";

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
          <div
            key={s.label}
            title={`${s.label}: ${s.count}`}
            className={segment()}
            style={{
              width: `${(s.count / denom) * 100}%`,
              backgroundColor: `color-mix(in srgb, ${token(`viz-${s.viz}`)} 55%, transparent)`,
            }}
          />
        ))}
        {sum < denom && (
          <div
            title={`unaccounted: ${denom - sum}`}
            data-surface="recess"
            className={rest()}
            style={{ width: `${((denom - sum) / denom) * 100}%` }}
          />
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
