import { TooltipHint } from "./tooltip";
/**
 * The key to a drawing's encoding, small and on the page ground, in a corner of the drawing. A
 * `ramp` is a band of swatches with its breaks under the seams; `rows` are one stroke sample, a
 * word and a count each. A value the encoding cannot read is a row too (`missing`), never left out:
 * blank reads as safe. The drawing owns the meaning (what a bin is, its stroke); this owns the look.
 */

import { tokenRef } from "../../lib/token";

const SWATCH_W = 64;

/** A line sample as the drawing inks it. `className` carries a dash role (`dash-seam`, ...). */
export interface LegendStroke {
  ink: string;
  width: number;
  className?: string;
  /** A direction arrow on the sample (a flow encoding's known bin). */
  arrow?: boolean;
  shape?: "box";
  fill?: string;
}

declare const shortWord: unique symbol;
export type LegendWord = string & { readonly [shortWord]: true };

/** Validate dynamic labels at the boundary; explanations belong in `says`. */
export function legendWord(text: string): LegendWord {
  if (!text.trim() || /[.!?](?:\s|$)/.test(text) || text.trim().split(/\s+/).length > 4)
    throw new Error(`Legend word must be one to four words without sentences: ${text}`);
  return text as LegendWord;
}

export interface LegendRow {
  key: string;
  stroke: LegendStroke;
  word: LegendWord;
  count?: number;
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
  /** The row for elements the reading cannot read; absent draws none. */
  missing?: LegendRow | null;
  className?: string;
}

function StrokeSample({ stroke }: { stroke: LegendStroke }) {
  return (
    <svg aria-hidden width={28} height={12} viewBox="0 0 28 12" className="shrink-0">
      {stroke.shape === "box" ? (
        <rect
          x={9}
          y={1}
          width={10}
          height={10}
          fill={stroke.fill ?? "none"}
          stroke={stroke.ink}
          strokeWidth={stroke.width}
          className={stroke.className}
        />
      ) : (
        <line
          x1={2}
          y1={6}
          x2={26}
          y2={6}
          stroke={stroke.ink}
          strokeWidth={Math.min(stroke.width, 8)}
          className={stroke.className}
        />
      )}
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
  missing,
  className = "",
}: LegendProps) {
  return (
    <TooltipHint content={says}>
      <section
        aria-label={`${label} legend`}
        data-legend={reading ?? label}
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
                <TooltipHint key={step.key} content={step.says}>
                  <span className="h-2.5" style={{ width: SWATCH_W, background: step.ink }} />
                </TooltipHint>
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
              <TooltipHint key={row.key} content={row.says}>
                <div
                  className="col-span-3 grid grid-cols-subgrid items-center"
                  tabIndex={row.says ? 0 : undefined}
                  data-bin={row.key}
                >
                  <StrokeSample stroke={row.stroke} />
                  <span className="whitespace-nowrap">{legendWord(row.word)}</span>
                  {row.count != null ? <Count n={row.count} /> : <span />}
                </div>
              </TooltipHint>
            ))}
          </div>
        ) : null}
        {missing ? (
          <TooltipHint content={missing.says}>
            <div
              className="flex items-center gap-2"
              tabIndex={missing.says ? 0 : undefined}
              data-bin={missing.key}
            >
              <StrokeSample stroke={missing.stroke} />
              <span className="text-ink-2 whitespace-nowrap">{legendWord(missing.word)}</span>
              {missing.count != null ? <Count n={missing.count} /> : null}
            </div>
          </TooltipHint>
        ) : null}
      </section>
    </TooltipHint>
  );
}
