/**
 * The Ductulator, drawn. A fixed base plate carries the friction and velocity scales; a clear
 * disk over it carries two cfm scales and the diameter scale. Drag the disk to set the diameter
 * (read in the window at six o'clock); drag the red cursor to pick a cfm and read Δp and velocity
 * straight across. Geometry in `ductulator.ts`; a `Face` is one printing of the wheel.
 */
import { useMemo, useRef, type PointerEvent, type ReactNode } from "react";

import {
  WINDOW,
  clamp,
  geometry,
  read,
  rectSides,
  ticks,
  wrap,
  type Face,
  type Range,
} from "./ductulator";

const INK = "var(--color-ink)";
export const BASE = "var(--color-viz-1)";
export const DISK = "var(--color-viz-2)";
export const CURSOR = "var(--color-viz-3)";

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });

/** One log scale on a ring: ticks at `r`, growing outward or inward, labels past the ticks. */
function Scale({
  r,
  out,
  angle,
  range,
  color,
  title,
}: {
  r: number;
  out: boolean;
  angle: (v: number) => number;
  range: Range;
  color: string;
  title: string;
}) {
  const s = out ? 1 : -1;
  const a0 = angle(range[0]);
  const a1 = angle(range[1]);
  const p = (a: number, rr: number) =>
    `${rr * Math.sin((a * Math.PI) / 180)},${-rr * Math.cos((a * Math.PI) / 180)}`;
  return (
    <g fill={color} stroke={color}>
      <path
        d={`M${p(a0, r)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1, r)}`}
        fill="none"
        strokeWidth={0.75}
      />
      {ticks(range).map((t) => (
        <g key={t.v} transform={`rotate(${angle(t.v)})`}>
          <line y1={-r} y2={-(r + s * (t.major ? 9 : 4.5))} strokeWidth={t.major ? 1 : 0.5} />
          {t.label && (
            <text y={-(r + s * 15)} dy={out ? 0 : 6} textAnchor="middle" fontSize={8} stroke="none">
              {t.label}
            </text>
          )}
        </g>
      ))}
      {/* the scale's name sits just before its first tick, where nothing else is */}
      <g transform={`rotate(${a0 - 3})`}>
        <text
          y={-(r + s * 15)}
          dy={out ? 0 : 6}
          textAnchor="end"
          fontSize={6}
          letterSpacing={0.8}
          stroke="none"
          opacity={0.8}
        >
          {title}
        </text>
      </g>
    </g>
  );
}

export function Ductulator({
  face,
  diameter,
  cfm,
  onDiameter,
  onCfm,
}: {
  face: Face;
  diameter: number;
  cfm: number;
  onDiameter: (d: number) => void;
  onCfm: (q: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "disk" | "cursor"; last: number; spin: number } | null>(null);
  const g = useMemo(() => geometry(face), [face]);
  const spin = g.spinOf(diameter);
  const cursor = g.disk.cfmFriction(cfm) + spin;
  const { friction, velocity } = read(cfm, diameter);

  const angleAt = (e: PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = e.clientY - (b.top + b.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  };
  const down = (kind: "disk" | "cursor") => (e: PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, last: angleAt(e), spin };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const a = angleAt(e);
    if (d.kind === "disk") {
      d.spin += wrap(a - d.last);
      d.last = a;
      onDiameter(clamp(g.diameterOf(d.spin), face.range.diameter));
    } else onCfm(clamp(g.cfmAtFriction(a - spin), face.range.cfmFriction));
  };
  const up = () => (drag.current = null);

  const rect = rectSides(diameter);
  const hub: ReactNode = (
    <g fontSize={8} fill={INK} textAnchor="middle">
      <text y={-52} fontSize={7} letterSpacing={1} opacity={0.7}>
        ROUND DUCT
      </text>
      <text y={-28} fontSize={24} fontWeight={600}>
        {fmt(diameter, 1)}″
      </text>
      <text y={-10}>
        <tspan fill={DISK}>{fmt(cfm, 0)} cfm</tspan>
        {"  ·  "}
        <tspan fill={BASE}>{fmt(friction, 3)} in. wg</tspan>
        {"  ·  "}
        <tspan fill={BASE}>{fmt(velocity, 0)} fpm</tspan>
      </text>
      <text y={6} fontSize={6.5} letterSpacing={1} opacity={0.7}>
        RECTANGULAR EQUIVALENTS
      </text>
      {rect.map(({ a, b }, i) => (
        <text key={a} x={-60 + (i % 3) * 60} y={18 + Math.floor(i / 3) * 10} fontSize={7.5}>
          {a} × {fmt(b, 0)}
        </text>
      ))}
    </g>
  );

  return (
    <svg
      ref={svg}
      viewBox="-330 -330 660 660"
      className="face-mono size-full touch-none select-none"
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {/* base plate */}
      <circle r={326} fill="var(--color-line)" fillOpacity={0.18} stroke="var(--color-line)" />
      <Scale r={292} out angle={g.base.friction} range={face.range.friction} color={BASE} title="FRICTION LOSS · IN. WG PER 100 FT" />
      <Scale r={234} out angle={g.base.velocity} range={face.range.velocity} color={BASE} title="VELOCITY · FPM" />

      {/* clear disk */}
      <g transform={`rotate(${spin})`} onPointerDown={down("disk")} style={{ cursor: "grab" }}>
        <circle r={284} fill={INK} fillOpacity={0.035} stroke={DISK} strokeWidth={1.5} />
        <Scale r={284} out={false} angle={g.disk.cfmFriction} range={face.range.cfmFriction} color={DISK} title="AIR VOLUME · CFM" />
        <Scale r={222} out={false} angle={g.disk.cfmVelocity} range={face.range.cfmVelocity} color={DISK} title="AIR VOLUME · CFM" />
        <Scale r={122} out angle={g.disk.diameter} range={face.range.diameter} color={DISK} title="ROUND DUCT · INCHES" />
        <circle r={110} fill="var(--color-line)" fillOpacity={0.35} stroke={DISK} strokeWidth={0.75} />
      </g>

      {/* base, above the disk: window frame, hub, cursor */}
      <g transform={`rotate(${WINDOW})`}>
        <rect x={-20} y={-158} width={40} height={46} rx={4} fill="none" stroke={INK} strokeWidth={1.5} />
        <line y1={-158} y2={-112} stroke={CURSOR} strokeWidth={0.75} />
      </g>
      {hub}
      <g transform={`rotate(${cursor})`} onPointerDown={down("cursor")} style={{ cursor: "ew-resize" }}>
        <line y1={-328} y2={-200} stroke={CURSOR} strokeWidth={1} />
        <line y1={-328} y2={-200} stroke="transparent" strokeWidth={14} />
        <circle cy={-318} r={5} fill={CURSOR} />
      </g>
      <g transform={`rotate(${g.disk.cfmVelocity(cfm) + spin})`} pointerEvents="none">
        <line y1={-262} y2={-200} stroke={CURSOR} strokeWidth={1} strokeDasharray="2 2" />
      </g>
    </svg>
  );
}
