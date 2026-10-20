/**
 * proto: encoding — the drawing's key to its encoding, bottom-left where the keys legend sits.
 * A sequential scale is a band of its ramp with the breaks under it, its unit, and the group's max
 * element named (a click selects it); line weight and categories are rows of their own stroke with
 * a count in this group. Missing values are a row, never left out: blank reads as safe water.
 * A kit candidate (`ScaleLegend` beside `KeyLegend`) once a second drawing wants it.
 */
import { tokenRef } from "@pe/kit/lib/token";

import { DASH_CLASS, formatQuantity, type Encoding, type Stroke } from "../../encoding";

const SWATCH_W = 64;

function StrokeSample({ stroke, arrow = false }: { stroke: Stroke; arrow?: boolean }) {
  return (
    <svg aria-hidden width={28} height={12} viewBox="0 0 28 12" className="shrink-0">
      <line
        x1={2}
        y1={6}
        x2={26}
        y2={6}
        stroke={stroke.ink}
        strokeWidth={Math.min(stroke.width, 8)}
        className={stroke.dash ? DASH_CLASS[stroke.dash] : undefined}
      />
      {arrow ? <path d="M12 2.5 17 6 12 9.5" fill="none" stroke={tokenRef("page")} strokeWidth={4} /> : null}
      {arrow ? <path d="M12 2.5 17 6 12 9.5" fill="none" stroke={stroke.ink} strokeWidth={1.5} /> : null}
    </svg>
  );
}

const Count = ({ n }: { n: number }) => (
  <span className="face-mono text-ink-2 min-w-6 text-right">{n}</span>
);

export function ScaleLegend({
  encoding,
  counts,
  nameOf,
  onSelect,
  className = "",
}: {
  encoding: Encoding;
  counts: ReadonlyMap<string, number>;
  nameOf: (id: number) => string | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const { quantity } = encoding;
  const bins = Object.entries(encoding.bins);
  const ramp = bins.filter(([key]) => key !== "missing");
  const missing = counts.get("missing") ?? 0;
  const f = (n: number) => (quantity ? formatQuantity(quantity, n) : String(n));
  const maxLine =
    quantity && quantity.maxId != null && quantity.max != null ? (
      <span className="flex items-center gap-1 whitespace-nowrap" data-scale-max={quantity.maxId}>
        max <span className="face-mono">{f(quantity.max)}</span> {quantity.unit} at
        <button
          type="button"
          className="max-w-56 cursor-pointer truncate underline decoration-dotted underline-offset-2"
          title={`select ${nameOf(quantity.maxId) ?? "it"}`}
          onClick={() => onSelect(quantity.maxId!)}
        >
          {nameOf(quantity.maxId) ?? "an unnamed element"}
        </button>
      </span>
    ) : quantity ? (
      <span className="text-ink-2">no element in this system has a value</span>
    ) : null;

  return (
    <section
      aria-label={`${encoding.label} legend`}
      data-scale-legend={encoding.key}
      title={encoding.says}
      className={`t-small flex select-none flex-col gap-1 rounded-sm px-2 py-1 font-sans ${className}`}
      style={{ background: tokenRef("page") }}
    >
      <span className="text-ink-2">
        {encoding.label}
        {quantity ? `, ${quantity.unit}` : null}
      </span>
      {encoding.kind === "sequential" ? (
        <div className="flex flex-col">
          <div className="flex gap-0.5" data-scale-band="">
            {ramp.map(([key, bin]) => (
              <span
                key={key}
                title={`${bin.word}: ${counts.get(key) ?? 0} elements`}
                className="h-2.5"
                style={{ width: SWATCH_W, background: bin.stroke.ink }}
              />
            ))}
          </div>
          {/* The min under the band's left end, each break under its seam, the max under the right end. */}
          <div
            className="face-mono text-ink-2 relative h-4"
            style={{ width: ramp.length * (SWATCH_W + 2) - 2 }}
          >
            {quantity && quantity.min != null && quantity.max != null
              ? [quantity.min, ...quantity.edges, quantity.max].map((n, i, all) => (
                  <span
                    key={i}
                    className="absolute top-0 whitespace-nowrap"
                    style={
                      i === all.length - 1
                        ? { right: 0 }
                        : { left: i * (SWATCH_W + 2) - (i ? 1 : 0), transform: i ? "translateX(-50%)" : undefined }
                    }
                  >
                    {f(n)}
                  </span>
                ))
              : null}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
          {(encoding.kind === "plain" ? [] : ramp).map(([key, bin]) => (
            <div key={key} className="contents" data-bin={key} title={bin.says}>
              <StrokeSample stroke={bin.stroke} arrow={encoding.kind === "flow" && key === "known"} />
              <span className="whitespace-nowrap">{bin.word}</span>
              <Count n={counts.get(key) ?? 0} />
            </div>
          ))}
          {encoding.kind === "plain" ? (
            <span className="text-ink-2 col-span-3">no reading: pick one above the drawing's right edge</span>
          ) : null}
        </div>
      )}
      {missing && encoding.bins.missing ? (
        <div className="flex items-center gap-2" data-bin="missing" title={encoding.bins.missing.says}>
          <StrokeSample stroke={encoding.bins.missing.stroke} />
          <span className="text-ink-2 whitespace-nowrap">no value</span>
          <Count n={missing} />
        </div>
      ) : null}
      {maxLine}
    </section>
  );
}
