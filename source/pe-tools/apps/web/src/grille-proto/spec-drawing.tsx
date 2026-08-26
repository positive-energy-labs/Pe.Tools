/**
 * SPEC DRAWING — the one pane that reflects per-slot information, drawn the way a Price
 * submittal draws a grille: line work in ink, no fills, extension lines + witness lines +
 * arrowheads, the dimension text ON the line. With `set` every dimension text is an input;
 * without it the drawing is read-only and serialises cleanly (no foreignObject) for export.
 * Plan (length × width) above, end SECTION below where opening / rib / edge live naturally.
 * Wood is a section hatch (non-hue channel; design-lang grayscale extension), not a brown fill.
 */
import { InchField } from "./field";
import type { Grille, GrilleInput } from "./math";
import { frac } from "./math";

const M = 56; // margin for dimension strings

export function SpecDrawing({
  g,
  set,
  px = 40,
  id = "",
}: {
  g: Grille;
  set?: (p: Partial<GrilleInput>) => void;
  /** px per inch. ponytail: fixed; fit-to-pane when boards exceed ~24″ */
  px?: number;
  /** suffix for <defs> ids when several drawings share a document */
  id?: string;
}) {
  const PX = px;
  const L = g.boardLength * PX;
  const W = g.boardWidth * PX;
  const x0 = g.endBorder * PX;
  const ol = g.openingLength * PX;
  const slots = Array.from(
    { length: g.openings },
    (_, k) => g.edgeBorder + k * (g.opening + g.rib),
  );
  const secY = W + M + 30;
  const secH = 0.75 * PX; // nominal board thickness — LORE, not in the sheet
  const bad = g.slack < -1e-9;
  const width = L + M * 2 + 40;
  const height = secY + secH + M;
  const hatch = `hatch${id}`;
  const arr = `arr${id}`;

  /** the dimension text: an input when editable, halo text when not */
  const dim = (key: keyof GrilleInput, int = false) =>
    set
      ? {
          children: (
            <InchField
              int={int}
              value={g[key]}
              onChange={(v) => set({ [key]: v })}
              style={int ? { ...inp, width: 32 } : inp}
            />
          ),
        }
      : { value: int ? String(g[key]) : `${frac(g[key])}″` };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${-M} ${-M} ${width} ${height}`}
      className="face-mono text-[10px]"
      style={{ color: "var(--r-ink)", fontFamily: "ui-monospace, monospace" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id={hatch}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="0.6" />
        </pattern>
        <marker
          id={arr}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>

      {/* ── PLAN ── */}
      <text x={0} y={-M + 10} fill="var(--r-ink-2)">
        PLAN
      </text>
      <rect width={L} height={W} fill="none" stroke="currentColor" strokeWidth="1.2" />
      {slots.map((y, k) => (
        <rect
          key={k}
          x={x0}
          y={y * PX}
          width={ol}
          height={g.opening * PX}
          fill="none"
          stroke={bad ? "var(--r-alarm)" : "currentColor"}
          strokeWidth="0.8"
        />
      ))}
      <line
        x1={-8}
        x2={L + 8}
        y1={W / 2}
        y2={W / 2}
        stroke="currentColor"
        strokeWidth="0.5"
        strokeDasharray="12 3 2 3"
      />
      <Wit arr={arr} x1={0} x2={L} y={-22} ext={[0, W]} {...dim("boardLength")} />
      <Wit arr={arr} x1={0} x2={x0} y={-8} small {...dim("endBorder")} />
      <Wit
        arr={arr}
        x1={x0}
        x2={x0 + ol}
        y={W + 16}
        ext={[W, W]}
        label={`${frac(g.openingLength)}″ opening length = L − 2·end`}
      />
      <VWit arr={arr} y1={0} y2={W} x={L + 22} ext={[0, L]} {...dim("boardWidth")} />

      {/* ── SECTION A-A ── */}
      <g transform={`translate(0 ${secY})`}>
        <text x={0} y={-12} fill="var(--r-ink-2)">
          SECTION A-A · ACROSS WIDTH
        </text>
        {[
          [0, g.edgeBorder],
          ...slots.map((y) => [y + g.opening, y + g.opening + g.rib]),
          [g.boardWidth - g.edgeBorder - (bad ? -g.slack : 0), g.boardWidth],
        ]
          .filter(([a, b]) => b! > a! + 1e-9)
          .map(([a, b], k) => (
            <rect
              key={k}
              x={a! * PX}
              y={0}
              width={(b! - a!) * PX}
              height={secH}
              fill={`url(#${hatch})`}
              stroke="currentColor"
              strokeWidth="1"
            />
          ))}
        {bad && (
          <rect
            x={g.middleAvailable * PX + g.edgeBorder * PX}
            y={0}
            width={-g.slack * PX}
            height={secH}
            fill="none"
            stroke="var(--r-alarm)"
            strokeDasharray="3 2"
          />
        )}
        <Wit arr={arr} x1={0} x2={g.edgeBorder * PX} y={-4} small {...dim("edgeBorder")} />
        <Wit
          arr={arr}
          x1={g.edgeBorder * PX}
          x2={(g.edgeBorder + g.opening) * PX}
          y={secH + 14}
          small
          ext={[secH, secH]}
          {...dim("opening")}
        />
        {g.ribs > 0 && (
          <Wit
            arr={arr}
            x1={(g.edgeBorder + g.opening) * PX}
            x2={(g.edgeBorder + g.opening + g.rib) * PX}
            y={-4}
            small
            {...dim("rib")}
          />
        )}
        <Wit
          arr={arr}
          x1={g.edgeBorder * PX}
          x2={(g.boardWidth - g.edgeBorder) * PX}
          y={secH + 34}
          ext={[secH, secH]}
          label={`${frac(g.middleAvailable)}″ middle · qty`}
          {...dim("openings", true)}
        />
        <Wit
          arr={arr}
          x1={0}
          x2={W}
          y={secH + 54}
          ext={[secH, secH]}
          label={`${frac(g.boardWidth)}″ · ${bad ? `OVER BY ${frac(-g.slack)}″` : g.slack > 1e-9 ? `${frac(g.slack)}″ slack` : "closes exactly"}`}
        />
      </g>
    </svg>
  );
}

const inp: React.CSSProperties = {
  width: 44,
  fontSize: 10,
  background: "var(--r-page)",
  textAlign: "center",
};

/** Dimension text with a page-coloured halo so it sits ON the line, submittal style. */
function Halo({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      stroke="var(--r-page)"
      strokeWidth={4}
      fill="currentColor"
      style={{ paintOrder: "stroke" }}
    >
      {text}
    </text>
  );
}

type WitProps = {
  arr: string;
  x1: number;
  x2: number;
  y: number;
  /** extension line reach from the object edge to the witness line, object y at [x1, x2] */
  ext?: [number, number];
  label?: string;
  small?: boolean;
  value?: string;
  children?: React.ReactNode;
};

function Wit({ arr, x1, x2, y, ext, label, small, value, children }: WitProps) {
  const w = small ? 48 : 52;
  const mid = (x1 + x2) / 2;
  return (
    <g stroke="currentColor" strokeWidth="0.6">
      {ext && (
        <>
          <line
            x1={x1}
            x2={x1}
            y1={ext[0] + (y < ext[0] ? -2 : 2)}
            y2={y + (y < ext[0] ? -4 : 4)}
          />
          <line
            x1={x2}
            x2={x2}
            y1={ext[1] + (y < ext[1] ? -2 : 2)}
            y2={y + (y < ext[1] ? -4 : 4)}
          />
        </>
      )}
      <line x1={x1} x2={x2} y1={y} y2={y} markerStart={`url(#${arr})`} markerEnd={`url(#${arr})`} />
      {children && (
        <foreignObject x={mid - w / 2} y={y - 9} width={w} height={18}>
          {children}
        </foreignObject>
      )}
      {value && <Halo x={mid} y={y + 3} text={value} />}
      {label && (
        <text x={mid} y={y - 3} textAnchor="middle" stroke="none" fill="var(--r-ink-2)">
          {label}
        </text>
      )}
    </g>
  );
}

function VWit({
  arr,
  y1,
  y2,
  x,
  ext,
  value,
  children,
}: {
  arr: string;
  y1: number;
  y2: number;
  x: number;
  ext?: [number, number];
  value?: string;
  children?: React.ReactNode;
}) {
  const mid = (y1 + y2) / 2;
  return (
    <g stroke="currentColor" strokeWidth="0.6">
      {ext && (
        <>
          <line y1={y1} y2={y1} x1={ext[1] + 2} x2={x + 4} />
          <line y1={y2} y2={y2} x1={ext[1] + 2} x2={x + 4} />
        </>
      )}
      <line x1={x} x2={x} y1={y1} y2={y2} markerStart={`url(#${arr})`} markerEnd={`url(#${arr})`} />
      {children && (
        <foreignObject x={x + 4} y={mid - 9} width={52} height={18}>
          {children}
        </foreignObject>
      )}
      {value && <Halo x={x + 22} y={mid + 3} text={value} />}
    </g>
  );
}
