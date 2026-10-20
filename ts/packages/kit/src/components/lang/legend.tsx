/**
 * The key to a drawing's encoding, small and on the page ground, in a corner of the drawing. A
 * `ramp` is a band of swatches with its breaks under the seams; `rows` are one stroke sample, a
 * word and a count each. A value the encoding cannot read is a row too (`missing`), never left out:
 * blank reads as safe. The drawing owns the meaning (what a bin is, its stroke); this owns the look.
 */
import type { ReactNode } from "react";

import { tokenRef } from "../../lib/token";

const SWATCH_W = 64;

/** A line sample as the drawing inks it. `className` carries a dash role (`dash-seam`, ...). */
export interface LegendStroke {
  ink: string;
  width: number;
  className?: string;
  /** A direction arrow on the sample (a flow encoding's known bin). */
  arrow?: boolean;
}

export interface LegendRow {
  key: string;
  stroke: LegendStroke;
  word: string;
  count: number;
  says?: string;
}

export interface LegendStep {
  key: string;
  ink: string;
  says?: string;
}

export interface LegendProps {
  /** The reading's name, then its unit after a comma. */
  label: string;
  unit?: string;
  /** The reading's one sentence, the legend's tooltip. */
  says?: string;
  /** Stable name for the legend's reading, as `data-legend`. */
  reading?: string;
  /** A sequential reading: the swatches and one break label per seam plus both ends. */
  ramp?: { steps: readonly LegendStep[]; breaks: readonly string[] };
  /** A categorical, weight or flow reading: one row per bin. */
  rows?: readonly LegendRow[];
  /** What to say when there is no reading to key. */
  plain?: ReactNode;
  /** The row for elements the reading cannot read; absent draws none. */
  missing?: LegendRow | null;
  /** A last line (the group's max element and a way to select it). */
  foot?: ReactNode;
  className?: string;
}

function StrokeSample({ stroke }: { stroke: LegendStroke }) {
  return (
    <svg aria-hidden width={28} height={12} viewBox="0 0 28 12" className="shrink-0">
      <line
        x1={2}
        y1={6}
        x2={26}
        y2={6}
        stroke={stroke.ink}
        strokeWidth={Math.min(stroke.width, 8)}
        className={stroke.className}
      />
      {stroke.arrow ? (
        <path d="M12 2.5 17 6 12 9.5" fill="none" stroke={tokenRef("page")} strokeWidth={4} />
      ) : null}
      {stroke.arrow ? (
        <path d="M12 2.5 17 6 12 9.5" fill="none" stroke={stroke.ink} strokeWidth={1.5} />
      ) : null}
    </svg>
  );
}

const Count = ({ n }: { n: number }) => (
  <span className="face-mono text-ink-2 min-w-6 text-right">{n}</span>
);

export function Legend({
  label,
  unit,
  says,
  reading,
  ramp,
  rows,
  plain,
  missing,
  foot,
  className = "",
}: LegendProps) {
  return (
    <section
      aria-label={`${label} legend`}
      data-legend={reading ?? label}
      title={says}
      className={`t-small flex select-none flex-col gap-1 rounded-sm px-2 py-1 font-sans ${className}`}
      style={{ background: tokenRef("page") }}
    >
      <span className="text-ink-2">
        {label}
        {unit ? `, ${unit}` : null}
      </span>
      {ramp ? (
        <div className="flex flex-col">
          <div className="flex gap-0.5" data-legend-band="">
            {ramp.steps.map((step) => (
              <span
                key={step.key}
                title={step.says}
                className="h-2.5"
                style={{ width: SWATCH_W, background: step.ink }}
              />
            ))}
          </div>
          {/* The min under the band's left end, each break under its seam, the max under the right end. */}
          <div
            className="face-mono text-ink-2 relative h-4"
            style={{ width: ramp.steps.length * (SWATCH_W + 2) - 2 }}
          >
            {ramp.breaks.map((text, i, all) => (
              <span
                key={i}
                className="absolute top-0 whitespace-nowrap"
                style={
                  i === all.length - 1
                    ? { right: 0 }
                    : {
                        left: i * (SWATCH_W + 2) - (i ? 1 : 0),
                        transform: i ? "translateX(-50%)" : undefined,
                      }
                }
              >
                {text}
              </span>
            ))}
          </div>
        </div>
      ) : rows?.length ? (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
          {rows.map((row) => (
            <div key={row.key} className="contents" data-bin={row.key} title={row.says}>
              <StrokeSample stroke={row.stroke} />
              <span className="whitespace-nowrap">{row.word}</span>
              <Count n={row.count} />
            </div>
          ))}
        </div>
      ) : plain != null ? (
        <span className="text-ink-2">{plain}</span>
      ) : null}
      {missing ? (
        <div className="flex items-center gap-2" data-bin={missing.key} title={missing.says}>
          <StrokeSample stroke={missing.stroke} />
          <span className="text-ink-2 whitespace-nowrap">{missing.word}</span>
          <Count n={missing.count} />
        </div>
      ) : null}
      {foot}
    </section>
  );
}
