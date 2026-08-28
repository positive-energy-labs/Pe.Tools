import { token } from "#/lib/token";
/**
 * SPEC DRAWING — the one pane that reflects per-slot information, drawn the way a Price
 * submittal draws a grille: line work in ink, no fills, extension lines + witness lines +
 * arrowheads, the dimension text ON the line. With `set` every dimension text is an input;
 * without it the drawing is read-only, every dimension is NAMED and set large (submittal
 * style), and it serialises cleanly (no foreignObject) for export.
 * Plan (length × width) above; SECTION A-A below at 2× as a detail, where opening / rib / edge
 * live naturally and their witness rows have room.
 * Wood is a section hatch (non-hue channel; design-lang grayscale extension), not a brown fill.
 */
import { InchField } from "./field";
import type { Grille, GrilleInput } from "./math";
import { frac } from "./math";

const NAMES: Record<keyof GrilleInput, string> = {
  boardLength: "BOARD LENGTH",
  endBorder: "END BORDER",
  boardWidth: "BOARD WIDTH",
  edgeBorder: "EDGE BORDER",
  opening: "OPENING WIDTH",
  rib: "RIB WIDTH",
  openings: "QTY OPENINGS",
};

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
  const ro = !set;
  const M = ro ? 76 : 56; // margin for dimension strings; named big numbers need more
  const PX = px;
  const SX = px * 2; // the section is a 2× detail
  const L = g.boardLength * PX;
  const W = g.boardWidth * PX;
  const x0 = g.endBorder * PX;
  const ol = g.openingLength * PX;
  const slots = Array.from(
    { length: g.openings },
    (_, k) => g.edgeBorder + k * (g.opening + g.rib),
  );
  const secY = W + M + 34;
  const secH = 0.75 * SX; // nominal board thickness — LORE, not in the sheet
  const bad = g.slack < -1e-9;
  const width = Math.max(L, g.boardWidth * SX) + M * 2 + 40;
  const height = secY + secH + 66 + 24 + M; // deepest witness row is at secH + 66
  const hatch = `hatch${id}`;
  const arr = `arr${id}`;
  const fs = ro ? 18 : 10;

  /** the dimension text: an input when editable; named halo text when not */
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
      : { value: int ? String(g[key]) : `${frac(g[key])}″`, label: NAMES[key] };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${-M} ${-M} ${width} ${height}`}
      className="face-mono"
      style={{ color: token("ink"), fontFamily: "ui-monospace, monospace", fontSize: 10 }}
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
      <text x={0} y={-M + 10} fill={token("ink-2")}>
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
          stroke={bad ? token("alarm") : "currentColor"}
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
      <Wit arr={arr} fs={fs} x1={0} x2={L} y={-M + 40} ext={[0, W]} {...dim("boardLength")} />
      <Wit arr={arr} fs={fs} x1={0} x2={x0} y={-8} small {...dim("endBorder")} />
      <Wit
        arr={arr}
        fs={10}
        x1={x0}
        x2={x0 + ol}
        y={W + 16}
        ext={[W, W]}
        label={`${frac(g.openingLength)}″ opening length = L − 2·end`}
      />
      <VWit arr={arr} fs={fs} y1={0} y2={W} x={L + 22} ext={[0, L]} {...dim("boardWidth")} />

      {/* ── SECTION A-A, 2× ── */}
      <g transform={`translate(0 ${secY})`}>
        <text x={0} y={-30} fill={token("ink-2")}>
          SECTION A-A · ACROSS WIDTH · 2×
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
              x={a! * SX}
              y={0}
              width={(b! - a!) * SX}
              height={secH}
              fill={`url(#${hatch})`}
              stroke="currentColor"
              strokeWidth="1"
            />
          ))}
        {bad && (
          <rect
            x={(g.edgeBorder + g.middleAvailable) * SX}
            y={0}
            width={-g.slack * SX}
            height={secH}
            fill="none"
            stroke={token("alarm")}
            strokeDasharray="3 2"
          />
        )}
        {/* above the section: edge · rib */}
        <Wit arr={arr} fs={fs} x1={0} x2={g.edgeBorder * SX} y={-8} small {...dim("edgeBorder")} />
        {g.ribs > 0 && (
          <Wit
            arr={arr}
            fs={fs}
            x1={(g.edgeBorder + g.opening) * SX}
            x2={(g.edgeBorder + g.opening + g.rib) * SX}
            y={-8}
            small
            {...dim("rib")}
          />
        )}
        {/* below: opening · middle · overall */}
        <Wit
          arr={arr}
          fs={fs}
          x1={g.edgeBorder * SX}
          x2={(g.edgeBorder + g.opening) * SX}
          y={secH + 16}
          small
          ext={[secH, secH]}
          {...dim("opening")}
        />
        <Wit
          arr={arr}
          fs={fs}
          x1={g.edgeBorder * SX}
          x2={(g.boardWidth - g.edgeBorder) * SX}
          y={secH + 42}
          ext={[secH, secH]}
          {...(ro
            ? {
                value: `${frac(g.middleAvailable)}″`,
                label: `MIDDLE AVAILABLE · ${g.openings} OPENINGS`,
              }
            : { label: `${frac(g.middleAvailable)}″ middle · qty`, ...dim("openings", true) })}
        />
        <Wit
          arr={arr}
          fs={10}
          x1={0}
          x2={g.boardWidth * SX}
          y={secH + 66}
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
  backgroundColor: token("page"),
  textAlign: "center",
};

/** Dimension text with a page-coloured halo so it sits ON the line, submittal style. */
function Halo({ x, y, text, fs }: { x: number; y: number; text: string; fs: number }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      stroke={token("page")}
      strokeWidth={fs / 3}
      fill="currentColor"
      fontSize={fs}
      style={{ paintOrder: "stroke" }}
    >
      {text}
    </text>
  );
}

type WitProps = {
  arr: string;
  fs: number;
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

function Wit({ arr, fs, x1, x2, y, ext, label, small, value, children }: WitProps) {
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
      {value && <Halo x={mid} y={y + fs / 3} text={value} fs={fs} />}
      {label && (
        <text
          x={mid}
          y={y - (value ? fs / 2 + 4 : 3)}
          textAnchor="middle"
          stroke="none"
          fill={token("ink-2")}
          fontSize={9}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function VWit({
  arr,
  fs,
  y1,
  y2,
  x,
  ext,
  value,
  label,
  children,
}: {
  arr: string;
  fs: number;
  y1: number;
  y2: number;
  x: number;
  ext?: [number, number];
  value?: string;
  label?: string;
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
      {value && (
        <g transform={`rotate(-90 ${x - 4} ${mid})`}>
          <Halo x={x - 4} y={mid - 2} text={value} fs={fs} />
          {label && (
            <text
              x={x - 4}
              y={mid - fs - 2}
              textAnchor="middle"
              stroke="none"
              fill={token("ink-2")}
              fontSize={9}
            >
              {label}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
