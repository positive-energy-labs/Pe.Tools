/**
 * THE FIELD — every buildable (opening width × qty) for the active row's stock and borders,
 * free % on y (the outcome), qty on x, one line per opening width. Clicking a point writes
 * {opening, openings, rib} into the active row; `stepField` walks it with arrow keys.
 * Ruled 2026-08-25 over free-%-vs-rib and an opening×qty lattice.
 */
import type { Grille, GrilleInput } from "./math";
import { frac, pct } from "./math";

type Props = {
  field: Grille[];
  active: Grille;
  onPick: (p: Partial<GrilleInput>) => void;
};

const W = 460;
const H = 240;
const PAD = { l: 36, r: 12, t: 12, b: 28 };
const same = (a: Grille, b: Grille) =>
  a.openings === b.openings && Math.abs(a.opening - b.opening) < 1e-6;

export function FieldChart({ field, active, onPick }: Props) {
  const maxN = Math.max(1, ...field.map((g) => g.openings));
  const maxFree = Math.max(0.05, ...field.map((g) => g.freeArea));
  const X = (n: number) => PAD.l + ((n - 1) / Math.max(1, maxN - 1)) * (W - PAD.l - PAD.r - 40);
  const Y = (f: number) => H - PAD.b - (f / maxFree) * (H - PAD.t - PAD.b);
  const widths = [...new Set(field.map((g) => g.opening))].sort((a, b) => a - b);
  return (
    <svg width={W} height={H} className="face-mono t-caption" style={{ color: "var(--pe-ink)" }}>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--pe-line-2)" />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--pe-line-2)" />
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--pe-ink-2)">
        qty openings →
      </text>
      <text x={4} y={PAD.t + 6} fill="var(--pe-ink-2)">
        free %
      </text>
      {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
        <text key={n} x={X(n)} y={H - PAD.b + 10} textAnchor="middle" fill="var(--pe-ink-mute)">
          {n}
        </text>
      ))}
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={Y(active.freeArea)}
        y2={Y(active.freeArea)}
        stroke="var(--pe-line)"
        strokeDasharray="3 3"
      />
      {widths.map((w) => {
        const pts = field.filter((g) => g.opening === w).sort((a, b) => a.openings - b.openings);
        const hot = Math.abs(w - active.opening) < 1e-6;
        const last = pts[pts.length - 1]!;
        return (
          <g key={w}>
            <polyline
              points={pts.map((g) => `${X(g.openings)},${Y(g.freeArea)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={hot ? 1.6 : 0.6}
              opacity={hot ? 1 : 0.5}
            />
            {/* label a line at its right end; one-point lines and odd sixteenths stay
                unlabelled so labels do not pile up — the hover title still names them */}
            {(hot || (pts.length > 1 && Math.round(w * 16) % 2 === 0)) && (
              <text
                x={X(last.openings) + 4}
                y={Y(last.freeArea) + 3}
                fill={hot ? "currentColor" : "var(--pe-ink-mute)"}
                fontWeight={hot ? 700 : 400}
              >
                {frac(w)}″
              </text>
            )}
            {pts.map((g, i) => {
              const on = same(g, active);
              return (
                <circle
                  key={i}
                  cx={X(g.openings)}
                  cy={Y(g.freeArea)}
                  r={on ? 5 : 2.5}
                  fill={on ? "var(--pe-page)" : "currentColor"}
                  stroke="currentColor"
                  strokeWidth={on ? 2 : 0}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPick({ opening: g.opening, openings: g.openings, rib: g.rib })}
                >
                  <title>{`${g.openings} × ${frac(g.opening)}″, ${frac(g.rib)}″ ribs → ${pct(g.freeArea)}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Keyboard stepping over the field: left/right walk qty along the active opening width,
 * up/down walk opening width at the active qty. Returns the neighbour to pick, or null at an edge.
 */
export function stepField(
  field: Grille[],
  active: Grille,
  key: string,
): Partial<GrilleInput> | null {
  const near = (g: Grille) => Math.abs(g.opening - active.opening) < 1e-6;
  let next: Grille | undefined;
  if (key === "ArrowRight" || key === "ArrowLeft") {
    const dir = key === "ArrowRight" ? 1 : -1;
    next = field
      .filter((g) => near(g) && Math.sign(g.openings - active.openings) === dir)
      .sort((a, b) => dir * (a.openings - b.openings))[0];
  } else if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowUp" ? 1 : -1;
    next = field
      .filter(
        (g) => g.openings === active.openings && Math.sign(g.opening - active.opening) === dir,
      )
      .sort((a, b) => dir * (a.opening - b.opening))[0];
  }
  return next ? { opening: next.opening, openings: next.openings, rib: next.rib } : null;
}
