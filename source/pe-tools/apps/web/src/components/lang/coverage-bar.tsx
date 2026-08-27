/**
 * COVERAGE BAR — proportions with an honest legend; THE viz ladder's first catalogued
 * consumer (base.css: "--viz-* … governed by the grayscale law (from ops CoverageBar,
 * this palette's first shipped consumer)").
 *
 * CONSUMERS: src/ops/** glance views (migrating from ops/primitives CoverageBar).
 *
 * RULINGS EMBODIED:
 * - Segments spend the VIZ ladder by INDEX (`viz: 1..6`), never a meaning role and never a
 *   named hue — a viz colour asserts "different from its neighbours" and nothing else.
 * - THE GRAYSCALE LAW: width, order and the legend (label + count) carry the meaning; colour
 *   only speeds it up. That is why the legend is not optional.
 * - An empty denominator renders NOTHING here: the caller owns its EmptyState, because only
 *   the caller knows the exit ("run a read", "widen the scope") — a primitive cannot.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

export interface CoverageSegment {
  label: string;
  count: number;
  /** Viz-ladder rung. Indexed, not named: 1..6. */
  viz: 1 | 2 | 3 | 4 | 5 | 6;
}

export function CoverageBar({
  segments,
  total,
  className,
}: {
  segments: readonly CoverageSegment[];
  /** Denominator; defaults to the segment sum. A shortfall renders as an unaccounted tail. */
  total?: number;
  className?: string;
}) {
  const sum = segments.reduce((acc, s) => acc + s.count, 0);
  const denom = total ?? sum;
  if (denom <= 0) return null;
  return (
    <div className={cn(className)}>
      <div className="dl-coverage">
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.count}`}
            className="dl-coverage-seg"
            style={{
              width: `${(s.count / denom) * 100}%`,
              background: `color-mix(in srgb, var(--viz-${s.viz}) 55%, transparent)`,
            }}
          />
        ))}
        {sum < denom && (
          <div
            title={`unaccounted: ${denom - sum}`}
            className="dl-coverage-rest"
            style={{ width: `${((denom - sum) / denom) * 100}%` }}
          />
        )}
      </div>
      <div className="dl-coverage-legend">
        {segments.map((s) => (
          <span key={s.label} className="dl-coverage-key">
            <span className="dl-coverage-dot" style={{ background: `var(--viz-${s.viz})` }} />
            <span className="dl-coverage-label">{s.label}</span> {s.count}
          </span>
        ))}
        {typeof total === "number" && <span className="dl-coverage-of">of {total}</span>}
      </div>
    </div>
  );
}
