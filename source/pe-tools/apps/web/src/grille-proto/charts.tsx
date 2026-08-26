/**
 * CHARTS — the same feasible field (every buildable opening × count for the active row's stock
 * and borders) under three axes. Clicking any point writes {opening, openings, rib} into the
 * active row. `?chart=rib|count|grid`.
 *
 *   rib    free % vs rib width          — the round-1 keeper: buildability cost on x.
 *   count  free % vs qty, one line per opening width — how count and width trade.
 *   grid   opening × qty lattice, magnitude as INK AREA (dot radius ∝ free %) — the scribd
 *          performance-sheet idea without its gradient: magnitude in a non-hue channel.
 */
import type { Grille, GrilleInput } from "./math";
import { frac, pct } from "./math";

export const CHARTS = [
  { key: "rib", name: "free % vs rib width" },
  { key: "count", name: "free % vs qty, per opening width" },
  { key: "grid", name: "opening × qty lattice, ink area = free %" },
];

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

export function Chart({ kind, ...p }: Props & { kind: string }) {
  if (kind === "count") return <ByCount {...p} />;
  if (kind === "grid") return <Grid {...p} />;
  return <ByRib {...p} />;
}

function Frame({
  xLabel,
  yLabel,
  children,
}: {
  xLabel: string;
  yLabel: string;
  children: React.ReactNode;
}) {
  return (
    <svg width={W} height={H} className="face-mono text-[9px]" style={{ color: "var(--r-ink)" }}>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--r-line-2)" />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--r-line-2)" />
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--r-ink-2)">
        {xLabel}
      </text>
      <text x={4} y={PAD.t + 6} fill="var(--r-ink-2)">
        {yLabel}
      </text>
      {children}
    </svg>
  );
}

const yFree = (maxFree: number) => (f: number) => H - PAD.b - (f / maxFree) * (H - PAD.t - PAD.b);

function Dot({
  g,
  on,
  x,
  y,
  onPick,
}: {
  g: Grille;
  on: boolean;
  x: number;
  y: number;
  onPick: Props["onPick"];
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={on ? 5 : 2.5}
      fill={on ? "var(--r-page)" : "currentColor"}
      stroke="currentColor"
      strokeWidth={on ? 2 : 0}
      style={{ cursor: "pointer" }}
      onClick={() => onPick({ opening: g.opening, openings: g.openings, rib: g.rib })}
    >
      <title>{`${g.openings} × ${frac(g.opening)}″, ${frac(g.rib)}″ ribs → ${pct(g.freeArea)}`}</title>
    </circle>
  );
}

function ByRib({ field, active, onPick }: Props) {
  const maxRib = Math.max(0.5, ...field.map((g) => g.rib));
  const maxFree = Math.max(0.05, ...field.map((g) => g.freeArea));
  const X = (r: number) => PAD.l + (r / maxRib) * (W - PAD.l - PAD.r);
  const Y = yFree(maxFree);
  return (
    <Frame xLabel="rib width, in (wider = easier to build) →" yLabel="free %">
      {[0.25, 0.5, 0.75, 1]
        .filter((r) => r <= maxRib)
        .map((r) => (
          <text key={r} x={X(r)} y={H - PAD.b + 10} textAnchor="middle" fill="var(--r-ink-mute)">
            {frac(r)}
          </text>
        ))}
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={Y(active.freeArea)}
        y2={Y(active.freeArea)}
        stroke="var(--r-line)"
        strokeDasharray="3 3"
      />
      {field.map((g, i) => (
        <Dot key={i} g={g} on={same(g, active)} x={X(g.rib)} y={Y(g.freeArea)} onPick={onPick} />
      ))}
    </Frame>
  );
}

function ByCount({ field, active, onPick }: Props) {
  const maxN = Math.max(...field.map((g) => g.openings));
  const maxFree = Math.max(0.05, ...field.map((g) => g.freeArea));
  const X = (n: number) => PAD.l + ((n - 1) / Math.max(1, maxN - 1)) * (W - PAD.l - PAD.r - 40);
  const Y = yFree(maxFree);
  const widths = [...new Set(field.map((g) => g.opening))].sort((a, b) => a - b);
  return (
    <Frame xLabel="qty openings →" yLabel="free %">
      {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
        <text key={n} x={X(n)} y={H - PAD.b + 10} textAnchor="middle" fill="var(--r-ink-mute)">
          {n}
        </text>
      ))}
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
            <text
              x={X(last.openings) + 4}
              y={Y(last.freeArea) + 3}
              fill={hot ? "currentColor" : "var(--r-ink-mute)"}
            >
              {frac(w)}″
            </text>
            {pts.map((g, i) => (
              <Dot
                key={i}
                g={g}
                on={same(g, active)}
                x={X(g.openings)}
                y={Y(g.freeArea)}
                onPick={onPick}
              />
            ))}
          </g>
        );
      })}
    </Frame>
  );
}

function Grid({ field, active, onPick }: Props) {
  const widths = [...new Set(field.map((g) => g.opening))].sort((a, b) => a - b);
  const maxN = Math.max(...field.map((g) => g.openings));
  const maxFree = Math.max(0.05, ...field.map((g) => g.freeArea));
  const cw = (W - PAD.l - PAD.r) / Math.max(1, widths.length);
  const ch = (H - PAD.t - PAD.b) / maxN;
  const X = (o: number) => PAD.l + (widths.indexOf(o) + 0.5) * cw;
  const Y = (n: number) => H - PAD.b - (n - 0.5) * ch;
  const rMax = Math.min(cw, ch) / 2 - 1;
  return (
    <Frame xLabel="opening width →" yLabel="qty">
      {widths.map((w, i) =>
        i % 2 === 0 ? (
          <text key={w} x={X(w)} y={H - PAD.b + 10} textAnchor="middle" fill="var(--r-ink-mute)">
            {frac(w)}
          </text>
        ) : null,
      )}
      {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => (
        <text key={n} x={PAD.l - 4} y={Y(n) + 3} textAnchor="end" fill="var(--r-ink-mute)">
          {n}
        </text>
      ))}
      {field.map((g, i) => {
        const on = same(g, active);
        // ink AREA carries magnitude: r ∝ sqrt(free) so the eye reads area, not radius
        const r = rMax * Math.sqrt(g.freeArea / maxFree);
        return (
          <circle
            key={i}
            cx={X(g.opening)}
            cy={Y(g.openings)}
            r={Math.max(1, r)}
            fill="currentColor"
            opacity={on ? 1 : 0.45}
            stroke={on ? "currentColor" : "none"}
            strokeWidth={on ? 2 : 0}
            style={{ cursor: "pointer" }}
            onClick={() => onPick({ opening: g.opening, openings: g.openings, rib: g.rib })}
          >
            <title>{`${g.openings} × ${frac(g.opening)}″, ${frac(g.rib)}″ ribs → ${pct(g.freeArea)}`}</title>
          </circle>
        );
      })}
      {(() => {
        const r = rMax * Math.sqrt(active.freeArea / maxFree);
        return (
          <circle
            cx={X(active.opening)}
            cy={Y(active.openings)}
            r={Math.max(1, r) + 3}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        );
      })()}
    </Frame>
  );
}
