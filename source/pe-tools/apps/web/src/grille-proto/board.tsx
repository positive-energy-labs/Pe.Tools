/**
 * Plan-view drawing of one grille. Shared by every variant so they are compared under the same
 * light; variant B layers inputs on top of it.
 */
import type { Grille } from "./math";
import { frac } from "./math";

export function Board({
  g,
  px = 28,
  dims = true,
  children,
}: {
  g: Grille;
  /** pixels per inch */
  px?: number;
  dims?: boolean;
  children?: React.ReactNode;
}) {
  const pad = dims ? 34 : 4;
  const W = g.boardLength * px;
  const H = g.boardWidth * px;
  const fits = g.slack >= -1e-9;
  const openings: number[] = [];
  let y = g.edgeBorder;
  for (let k = 0; k < g.openings; k++) {
    openings.push(y);
    y += g.opening + g.rib;
  }
  const x0 = g.endBorder * px;
  const ol = g.openingLength * px;
  return (
    <svg
      width={W + pad * 2}
      height={H + pad * 2}
      viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`}
      className="select-none"
      style={{ fontFamily: "ui-monospace, monospace", fontSize: 10 }}
    >
      <rect width={W} height={H} fill="var(--r-surface-2, #d9c3a0)" stroke="var(--r-ink)" />
      {openings.map((oy, k) => (
        <rect
          key={k}
          x={x0}
          y={oy * px}
          width={ol}
          height={g.opening * px}
          fill={fits ? "var(--r-ink)" : "var(--r-danger, #c0392b)"}
          opacity={0.85}
        />
      ))}
      {!fits && (
        <text x={W / 2} y={H + 14} textAnchor="middle" fill="var(--r-danger, #c0392b)">
          over by {frac(-g.slack)}″
        </text>
      )}
      {dims && (
        <>
          <Dim x1={0} x2={W} y={-14} label={`${frac(g.boardLength)}″ board`} />
          <Dim x1={x0} x2={x0 + ol} y={-4} label={`${frac(g.openingLength)}″ opening`} small />
          <VDim y1={0} y2={H} x={-14} label={`${frac(g.boardWidth)}″`} />
          <VDim
            y1={g.edgeBorder * px}
            y2={(g.edgeBorder + g.middleAvailable) * px}
            x={W + 10}
            label={`${frac(g.middleAvailable)}″ middle`}
          />
        </>
      )}
      {children}
    </svg>
  );
}

function Dim({
  x1,
  x2,
  y,
  label,
  small,
}: {
  x1: number;
  x2: number;
  y: number;
  label: string;
  small?: boolean;
}) {
  return (
    <g stroke="var(--r-ink-mute)" fill="var(--r-ink-mute)">
      <line x1={x1} x2={x2} y1={y} y2={y} />
      <line x1={x1} x2={x1} y1={y - 3} y2={y + 3} />
      <line x1={x2} x2={x2} y1={y - 3} y2={y + 3} />
      <text x={(x1 + x2) / 2} y={y - 2} textAnchor="middle" stroke="none" fontSize={small ? 8 : 10}>
        {label}
      </text>
    </g>
  );
}

function VDim({ y1, y2, x, label }: { y1: number; y2: number; x: number; label: string }) {
  return (
    <g stroke="var(--r-ink-mute)" fill="var(--r-ink-mute)">
      <line x1={x} x2={x} y1={y1} y2={y2} />
      <line x1={x - 3} x2={x + 3} y1={y1} y2={y1} />
      <line x1={x - 3} x2={x + 3} y1={y2} y2={y2} />
      <text
        x={x}
        y={(y1 + y2) / 2}
        textAnchor="middle"
        stroke="none"
        transform={`rotate(-90 ${x} ${(y1 + y2) / 2}) translate(0 -3)`}
      >
        {label}
      </text>
    </g>
  );
}

/** One-line readout used under every drawing. */
export function Readout({ g }: { g: Grille }) {
  return (
    <div className="face-mono flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--r-ink-mute)]">
      <span>
        free <b className="text-[var(--r-ink)]">{(g.freeArea * 100).toFixed(1)}%</b>
      </span>
      <span>before derate {(g.freeAreaBeforeDerate * 100).toFixed(1)}%</span>
      <span>length derate ×{g.lengthDerate.toFixed(3)}</span>
      <span>
        actual <b className="text-[var(--r-ink)]">{g.actualFreeArea.toFixed(2)} in²</b>
      </span>
      <span>
        middle {frac(g.middleDimension)}″ of {frac(g.middleAvailable)}″
        {g.slack < -1e-9 ? (
          <b className="text-[var(--r-danger,#c0392b)]"> — does not fit</b>
        ) : g.slack > 1e-9 ? (
          ` (${frac(g.slack)}″ slack)`
        ) : (
          " — exact"
        )}
      </span>
    </div>
  );
}
