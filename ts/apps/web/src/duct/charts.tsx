/**
 * Lenses on the same law the wheel spins. Every chart here is log-log, because on log axes a
 * power law is a straight line and its exponent is the slope you can see: Δp runs at 1.9 against
 * cfm, −5.02 against diameter; velocity at −2 against diameter. The friction chart is the ASHRAE
 * figure the Ductulator was printed from: lines of constant diameter rising at 1/1.9, lines of
 * constant velocity falling across them. Drag on any chart and the wheel follows.
 */
import { useRef, useState, type PointerEvent } from "react";

import { C, EXP, diameterFor, read, ticks, type Face, type Range } from "./ductulator";
import { BASE, CURSOR, DISK } from "./wheel";

const INK2 = "var(--color-ink-2)";
const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });

type Pt = readonly [number, number];
type Series = { key: string; label: string; color: string; dash?: string; pts: Pt[]; labelAt?: "end" | "mid" };

const W = 420;
const H = 300;
const M = { l: 40, r: 36, t: 10, b: 28 };

/** A log-log plot. Children of the law: curves, one marker, a crosshair, direct labels. */
function LogLog({
  title,
  note,
  x,
  y,
  series,
  point,
  readout,
  onPick,
}: {
  title: string;
  note?: string;
  x: { label: string; range: Range };
  y: { label: string; range: Range };
  series: Series[];
  point: Pt;
  readout: (p: Pt) => string;
  onPick?: (p: Pt) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const down = useRef(false);
  const lx = (v: number) => Math.log10(v);
  const sx = (v: number) => M.l + ((lx(v) - lx(x.range[0])) / (lx(x.range[1]) - lx(x.range[0]))) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((lx(v) - lx(y.range[0])) / (lx(y.range[1]) - lx(y.range[0]))) * (H - M.t - M.b);
  const inX = (v: number) => v >= x.range[0] && v <= x.range[1];
  const inY = (v: number) => v >= y.range[0] && v <= y.range[1];

  const at = (e: PointerEvent): Pt | null => {
    const b = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    const py = ((e.clientY - b.top) / b.height) * H;
    if (px < M.l || px > W - M.r || py < M.t || py > H - M.b) return null;
    const vx = 10 ** (lx(x.range[0]) + ((px - M.l) / (W - M.l - M.r)) * (lx(x.range[1]) - lx(x.range[0])));
    const vy = 10 ** (lx(y.range[0]) + ((H - M.b - py) / (H - M.t - M.b)) * (lx(y.range[1]) - lx(y.range[0])));
    return [vx, vy];
  };
  const move = (e: PointerEvent) => {
    const p = at(e);
    setHover(p);
    if (p && down.current) onPick?.(p);
  };

  const id = `clip-${title.replace(/\W+/g, "-")}`;
  const path = (pts: Pt[]) =>
    pts
      .filter(([a, b]) => a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b))
      .map(([a, b], i) => `${i ? "L" : "M"}${sx(a).toFixed(1)},${sy(b).toFixed(1)}`)
      .join("");
  const endLabel = (s: Series) => {
    const inside = s.pts.filter(([a, b]) => inX(a) && inY(b));
    if (!inside.length) return null;
    return inside[s.labelAt === "mid" ? Math.floor(inside.length / 2) : inside.length - 1];
  };

  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="t-prose">
        <span className="font-medium">{title}</span>
        {note && <span className="face-mono block text-ink-2">{note}</span>}
      </figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="face-mono w-full touch-none select-none"
        style={{ cursor: onPick ? "crosshair" : "default" }}
        onPointerDown={(e) => {
          down.current = true;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const p = at(e);
          if (p) onPick?.(p);
        }}
        onPointerMove={move}
        onPointerUp={() => (down.current = false)}
        onPointerLeave={() => {
          setHover(null);
          down.current = false;
        }}
      >
        <defs>
          <clipPath id={id}>
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
          </clipPath>
        </defs>
        {/* grid: decades solid, 2 and 5 faint */}
        <g stroke="var(--color-line)" strokeWidth={0.5}>
          {ticks(x.range, [1, 2, 5]).filter((t) => t.label).map((t) => (
            <line key={`x${t.v}`} x1={sx(t.v)} x2={sx(t.v)} y1={M.t} y2={H - M.b} opacity={Math.log10(t.v) % 1 === 0 ? 1 : 0.4} />
          ))}
          {ticks(y.range, [1, 2, 5]).filter((t) => t.label).map((t) => (
            <line key={`y${t.v}`} y1={sy(t.v)} y2={sy(t.v)} x1={M.l} x2={W - M.r} opacity={Math.log10(t.v) % 1 === 0 ? 1 : 0.4} />
          ))}
        </g>
        <g fontSize={8} fill={INK2}>
          {ticks(x.range, [1, 2, 5]).filter((t) => t.label).map((t) => (
            <text key={t.v} x={sx(t.v)} y={H - M.b + 11} textAnchor="middle">{t.label}</text>
          ))}
          {ticks(y.range, [1, 2, 5]).filter((t) => t.label).map((t) => (
            <text key={t.v} x={M.l - 4} y={sy(t.v) + 3} textAnchor="end">{t.label}</text>
          ))}
          <text x={W - M.r} y={H - 4} textAnchor="end" letterSpacing={0.8}>{x.label}</text>
          <text x={M.l} y={M.t - 2} transform={`rotate(-90 ${M.l - 30} ${M.t + 8})`} letterSpacing={0.8} />
          <text x={M.l + 2} y={M.t + 8} letterSpacing={0.8}>{y.label}</text>
        </g>
        <g clipPath={`url(#${id})`} fill="none" strokeWidth={1.25} strokeLinejoin="round">
          {series.map((s) => (
            <path key={s.key} d={path(s.pts)} stroke={s.color} strokeDasharray={s.dash} />
          ))}
        </g>
        <g fontSize={7.5} fill={INK2}>
          {series.map((s) => {
            const e = endLabel(s);
            return e && <text key={s.key} x={sx(e[0]) + 3} y={sy(e[1]) - 2}>{s.label}</text>;
          })}
        </g>
        {hover && (
          <g pointerEvents="none">
            <line x1={sx(hover[0])} x2={sx(hover[0])} y1={M.t} y2={H - M.b} stroke={INK2} strokeWidth={0.5} strokeDasharray="2 2" />
            <line y1={sy(hover[1])} y2={sy(hover[1])} x1={M.l} x2={W - M.r} stroke={INK2} strokeWidth={0.5} strokeDasharray="2 2" />
            <text x={W - M.r} y={M.t + 8} textAnchor="end" fontSize={8} fill="var(--color-ink)">{readout(hover)}</text>
          </g>
        )}
        {inX(point[0]) && inY(point[1]) && (
          <circle cx={sx(point[0])} cy={sy(point[1])} r={4} fill={CURSOR} stroke="var(--color-document)" strokeWidth={2} pointerEvents="none" />
        )}
      </svg>
    </figure>
  );
}

const logspace = ([lo, hi]: Range, n = 48) =>
  Array.from({ length: n }, (_, i) => 10 ** (Math.log10(lo) + (i / (n - 1)) * Math.log10(hi / lo)));

const SIZES = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 30, 36, 42, 48, 60];
const SPEEDS = [300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000];

export function DuctCharts({
  face,
  cfm,
  diameter,
  onPick,
}: {
  face: Face;
  cfm: number;
  diameter: number;
  onPick: (next: { cfm?: number; diameter?: number }) => void;
}) {
  const { friction, velocity } = read(cfm, diameter);
  const r = face.range;
  const within = ([lo, hi]: Range) => (v: number) => v >= lo && v <= hi;

  const constantD: Series[] = SIZES.filter(within(r.diameter)).map((D) => ({
    key: `D${D}`,
    label: `${D}″`,
    color: BASE,
    pts: logspace(r.friction).map((dp) => [dp, ((dp * D ** EXP.diameter) / C) ** (1 / EXP.cfm)] as const),
  }));
  const constantV: Series[] = SPEEDS.filter(within(r.velocity)).map((V) => ({
    key: `V${V}`,
    label: `${V} fpm`,
    color: DISK,
    dash: "3 3",
    labelAt: "mid",
    pts: logspace(r.cfmFriction).map((Q) => {
      const D = Math.sqrt((576 * Q) / (Math.PI * V));
      return [read(Q, D).friction, Q] as const;
    }),
  }));

  return (
    <div className="grid gap-(--gutter) lg:grid-cols-[2fr_1fr_1fr_1fr]">
      <LogLog
        title="Friction chart"
        note={`Δp = ${C}·Q^${EXP.cfm} / D^${EXP.diameter}  ·  solid: diameter, dashed: velocity`}
        x={{ label: "FRICTION LOSS · IN. WG / 100 FT", range: r.friction }}
        y={{ label: "CFM", range: r.cfmFriction }}
        series={[...constantD, ...constantV]}
        point={[friction, cfm]}
        readout={([dp, Q]) => {
          const D = diameterFor(Q, dp);
          return `${fmt(Q, 0)} cfm · ${fmt(dp, 3)} in. wg → ${fmt(D, 1)}″ · ${fmt(read(Q, D).velocity, 0)} fpm`;
        }}
        onPick={([dp, Q]) => onPick({ cfm: Q, diameter: diameterFor(Q, dp) })}
      />
      <LogLog
        title={`Δp against diameter, ${fmt(cfm, 0)} cfm`}
        note={`slope −${EXP.diameter}  ·  Δp = ${fmt(C * cfm ** EXP.cfm, 0)} / D^${EXP.diameter}`}
        x={{ label: "DIAMETER · IN", range: r.diameter }}
        y={{ label: "IN. WG / 100 FT", range: r.friction }}
        series={[{ key: "dp", label: "", color: BASE, pts: logspace(r.diameter).map((D) => [D, read(cfm, D).friction] as const) }]}
        point={[diameter, friction]}
        readout={([D]) => `${fmt(D, 1)}″ → ${fmt(read(cfm, D).friction, 3)} in. wg`}
        onPick={([D]) => onPick({ diameter: D })}
      />
      <LogLog
        title={`Δp against cfm, ${fmt(diameter, 1)}″`}
        note={`slope ${EXP.cfm}  ·  Δp = ${(C / diameter ** EXP.diameter).toExponential(2)} · Q^${EXP.cfm}`}
        x={{ label: "CFM", range: r.cfmFriction }}
        y={{ label: "IN. WG / 100 FT", range: r.friction }}
        series={[{ key: "dp", label: "", color: BASE, pts: logspace(r.cfmFriction).map((Q) => [Q, read(Q, diameter).friction] as const) }]}
        point={[cfm, friction]}
        readout={([Q]) => `${fmt(Q, 0)} cfm → ${fmt(read(Q, diameter).friction, 3)} in. wg`}
        onPick={([Q]) => onPick({ cfm: Q })}
      />
      <LogLog
        title={`Velocity against diameter, ${fmt(cfm, 0)} cfm`}
        note={`slope −${EXP.velocityDiameter}  ·  V = 576·${fmt(cfm, 0)} / (π·D²)`}
        x={{ label: "DIAMETER · IN", range: r.diameter }}
        y={{ label: "FPM", range: r.velocity }}
        series={[{ key: "v", label: "", color: DISK, pts: logspace(r.diameter).map((D) => [D, read(cfm, D).velocity] as const) }]}
        point={[diameter, velocity]}
        readout={([D]) => `${fmt(D, 1)}″ → ${fmt(read(cfm, D).velocity, 0)} fpm`}
        onPick={([D]) => onPick({ diameter: D })}
      />
    </div>
  );
}
