/**
 * A minimap is a floater kind (ledger 2026-10-21): a small picture of the whole field with the
 * viewport drawn on it; a click writes the viewport (`"move"`), a drag glides it (`"gesture"`).
 * Two pictures, one contract: `PlaneMinimap` for a scrolled or panned plane (the families pivot
 * minimap, generalised) and `OrbitMinimap` for an orbit camera (the ducts globe, ported).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";

import { tokenRef } from "@pe/kit/lib/token";

import type { OrbitViewport, PlaneViewport, ScrollViewport } from "@pe/agent-contracts";
export type { OrbitViewport, PlaneViewport, ScrollViewport };

import { glideLook, type LiveOrbit, type OrbitGesture } from "#/scene/live-orbit";

type ViewportHow = "gesture" | "move";

interface MinimapProps<V> {
  viewport: V;
  onViewport: (next: V, how: ViewportHow) => void;
}

type Size = { width: number; height: number };

/* ── The plane ─────────────────────────────────────────────────────────────── */

// ponytail: one fixed thumbnail box, as the pivot minimap had; size it from the floater when a
// consumer needs a different one.
const THUMB = 260;

/**
 * A role's colour for a canvas `paint`. Tokens are `light-dark(...)`, which a canvas fillStyle
 * refuses; the canvas's own computed colour resolves them for the current theme.
 */
export const canvasColor = (ctx: CanvasRenderingContext2D, role: string): string => {
  const paper = ctx.canvas;
  paper.style.color = tokenRef(role);
  const colour = getComputedStyle(paper).color;
  paper.style.color = "";
  return colour;
};

/** The field rectangle the viewport shows, in field units. */
const visibleRect = (v: PlaneViewport | ScrollViewport, size: Size) =>
  v.kind === "scroll"
    ? { x: v.left, y: v.top, width: size.width, height: size.height }
    : {
        x: -v.tx / v.scale,
        y: -v.ty / v.scale,
        width: size.width / v.scale,
        height: size.height / v.scale,
      };

/** The viewport centred on field point (x, y); a scroll viewport stays inside the field. */
const centredOn = <V extends PlaneViewport | ScrollViewport>(
  v: V,
  x: number,
  y: number,
  size: Size,
  extent: Size,
): V =>
  v.kind === "scroll"
    ? {
        ...v,
        left: Math.max(0, Math.min(extent.width - size.width, x - size.width / 2)),
        top: Math.max(0, Math.min(extent.height - size.height, y - size.height / 2)),
      }
    : { ...v, tx: size.width / 2 - x * v.scale, ty: size.height / 2 - y * v.scale };

export function PlaneMinimap<V extends PlaneViewport | ScrollViewport>({
  viewport,
  onViewport,
  extent,
  viewportSize,
  paint,
}: MinimapProps<V> & {
  extent: Size;
  viewportSize: Size;
  paint: (ctx: CanvasRenderingContext2D, scale: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragged = useRef(false);
  const k = Math.min(THUMB / extent.width, THUMB / extent.height);
  const w = Math.round(extent.width * k);
  const h = Math.round(extent.height * k);
  // Painted once per `paint` identity and size; a viewport change moves only the box.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    paint(ctx, k);
  }, [paint, k, w, h]);
  const box = visibleRect(viewport, viewportSize);
  const at = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return centredOn(
      viewport,
      (event.clientX - rect.left) / k,
      (event.clientY - rect.top) / k,
      viewportSize,
      extent,
    );
  };
  return (
    <div className="relative" style={{ width: w, height: h }} data-minimap="plane">
      <canvas
        ref={canvas}
        width={w}
        height={h}
        aria-label="field thumbnail; click to move the view"
        className="block cursor-crosshair touch-none"
        onPointerDown={(event) => {
          dragged.current = false;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          dragged.current = true;
          onViewport(at(event), "gesture");
        }}
        onClick={(event) => {
          if (dragged.current) return;
          onViewport(at(event), "move");
        }}
      />
      <div
        data-minimap-viewport=""
        className="pointer-events-none absolute text-ink"
        style={{
          left: box.x * k,
          top: box.y * k,
          width: Math.max(4, box.width * k),
          height: Math.max(4, box.height * k),
          border: "1px solid currentColor",
        }}
      />
    </div>
  );
}

/* ── The orbit ─────────────────────────────────────────────────────────────── */

const SIZE = 220;
const C = SIZE / 2;
const R = 92;
const ARC_STEPS = 96;
const DEG_PER_PX = 0.4;

type Vec = readonly [number, number, number];
const rad = (deg: number) => (deg * Math.PI) / 180;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clampElev = (v: number) => Math.min(90, Math.max(0, v));

/** The unit vector from the pivot to the eye at `yaw`/`elev` degrees, in `scene/orbit.ts`'s frame
 * (yaw 0 = the eye on +X, 90 = on +Y), so the globe and the camera read one viewport alike. */
const towards = (yaw: number, elev: number): Vec => {
  const cosE = Math.cos(rad(elev));
  return [Math.cos(rad(yaw)) * cosE, Math.sin(rad(yaw)) * cosE, Math.sin(rad(elev))];
};

/** The globe's projection: a unit-sphere point to SVG coordinates, at the viewport's yaw/elev. */
const globeProjection = (yaw: number, elev: number) => {
  const cos = Math.cos(rad(yaw));
  const sin = Math.sin(rad(yaw));
  const sinE = Math.sin(rad(elev));
  const cosE = Math.cos(rad(elev));
  return (p: readonly number[]): [number, number] => {
    // Screen right is the camera's right; depth runs away from the eye.
    const depth = -(p[0]! * cos + p[1]! * sin);
    return [C + (p[1]! * cos - p[0]! * sin) * R, C - (depth * sinE + p[2]! * cosE) * R];
  };
};

/** The 18 orientations, as camera yaw (null keeps the yaw) and elevation. */
const STOPS: readonly { rel: number | null; elev: number; pole: boolean }[] = [
  { rel: null, elev: 90, pole: true },
  { rel: null, elev: -90, pole: true },
  ...[0, 90, 180, 270].map((rel) => ({ rel, elev: 0, pole: true })),
  ...[45, 135, 225, 315].map((rel) => ({ rel, elev: 0, pole: false })),
  ...[0, 90, 180, 270].flatMap((rel) => [
    { rel, elev: 45, pole: false },
    { rel, elev: -45, pole: false },
  ]),
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
/** The compass word of a plan direction, from project north (+y). */
const bearing = (v: Vec, step: 45 | 90 = 45) => {
  const deg = ((((Math.atan2(v[0], v[1]) * 180) / Math.PI) % 360) + 360) % 360;
  return COMPASS[((Math.round(deg / step) * step) / 45) % 8]!;
};
const poleLabel = (v: Vec, elev: number) =>
  elev === 90 ? "Up" : elev === -90 ? "Down" : bearing(v, 90);
const stopTitle = (v: Vec, elev: number) =>
  elev === 90
    ? "Up: plan, looking straight down"
    : elev < 0
      ? "below the floor: elevation stops at 0°"
      : elev === 0
        ? `elevation from the ${bearing(v)}, level with the model`
        : `from the ${bearing(v)}, ${elev}° above`;

/**
 * The globe: a wire sphere whose three great circles (plan, N-S and E-W) carry 6 poles and 12
 * mid-arc stops; a click on a stop writes that orientation, a drag turns the globe. Far-side wire
 * and stops draw dim, behind the picture; stops below the floor are drawn and refused. `paint` draws
 * the picture inside the sphere through the globe's own projection (unit-sphere space, z up).
 */
export function OrbitMinimap({
  orbit,
  paint,
}: {
  orbit: LiveOrbit;
  paint?: (project: (p: readonly number[]) => [number, number]) => ReactNode;
  stops?: "globe";
}) {
  const viewport = useSyncExternalStore(orbit.subscribe, orbit.read);
  const { yaw, elev } = viewport ?? { yaw: 0, elev: 0 };
  const pressed = useRef<{
    x: number;
    y: number;
    moved: boolean;
    ended?: boolean;
    token: OrbitGesture;
  } | null>(null);
  useEffect(
    () => () => {
      if (pressed.current) orbit.cancel(pressed.current.token);
    },
    [orbit],
  );
  const body = useMemo(() => {
    const at = globeProjection(yaw, elev);
    const eye = towards(yaw, elev);
    const circles = [
      (t: number): Vec => [Math.cos(t), Math.sin(t), 0],
      ...[0, 90].map((rel) => {
        const u = towards(rel, 0);
        return (t: number): Vec => [u[0] * Math.cos(t), u[1] * Math.cos(t), Math.sin(t)];
      }),
    ];
    // Each circle splits into the near half (solid) and the far half (faint).
    let near = "";
    let far = "";
    for (const circle of circles)
      for (let i = 0; i < ARC_STEPS; i++) {
        const a = circle((i / ARC_STEPS) * 2 * Math.PI);
        const b = circle(((i + 1) / ARC_STEPS) * 2 * Math.PI);
        const [x1, y1] = at(a);
        const [x2, y2] = at(b);
        const piece = `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
        if (dot(a, eye) + dot(b, eye) >= -1e-9) near += piece;
        else far += piece;
      }
    const stops = STOPS.map((stop) => {
      const v = towards(stop.rel ?? 0, stop.elev);
      const [x, y] = at(v);
      return { ...stop, v, x, y, front: dot(v, eye) >= -1e-9 };
    });
    // N and S ride the rim, just outside the wire, at project north and south (+y, -y).
    const rim = (["N", "S"] as const).map((look) => {
      const v: Vec = [0, look === "N" ? 1 : -1, 0];
      const [x, y] = at(v);
      const out = Math.hypot(x - C, y - C);
      const k = out < 1 ? 0 : (R + 16) / out;
      return { look, x: out < 1 ? C : C + (x - C) * k, y: out < 1 ? C - R - 16 : C + (y - C) * k, front: dot(v, eye) >= -1e-9 };
    });
    return { at, near, far, stops, rim };
  }, [yaw, elev]);

  const dots = (front: boolean): ReactNode =>
    body.stops.map((stop, i) => {
      if (stop.front !== front) return null;
      const below = stop.elev < 0;
      const label = stop.pole ? poleLabel(stop.v, stop.elev) : null;
      // The label sits just outside the dot, pushed away from the globe's centre.
      const out = Math.hypot(stop.x - C, stop.y - C);
      const lx = out < 4 ? 0 : ((stop.x - C) / out) * 12;
      const ly = out < 4 ? -10 : ((stop.y - C) / out) * 12;
      return (
        <g
          key={i}
          data-orbit-stop={`${stop.rel ?? "pole"}/${stop.elev}`}
          data-orbit-label={label ?? undefined}
          data-far={front ? undefined : ""}
          data-refused={below ? "" : undefined}
          transform={`translate(${stop.x.toFixed(1)} ${stop.y.toFixed(1)})`}
          style={{ cursor: below ? "not-allowed" : "pointer" }}
          opacity={front ? 1 : 0.35}
          onClick={() => {
            if (below || pressed.current?.moved) return;
            if (viewport) orbit.move({ ...viewport, yaw: stop.rel ?? yaw, elev: stop.elev });
          }}
        >
          <title>{stopTitle(stop.v, stop.elev)}</title>
          <circle r={9} fill="transparent" />
          <circle
            r={stop.pole ? 4 : 2.75}
            fill={tokenRef(below ? "line" : "page")}
            stroke={tokenRef("ink-2")}
            strokeWidth={1}
          />
          {label ? (
            <text
              x={lx}
              y={ly + 3.5}
              fontSize={10}
              textAnchor="middle"
              className="face-mono"
              fill={tokenRef(below ? "ink-mute" : "ink")}
              pointerEvents="none"
            >
              {label}
            </text>
          ) : null}
        </g>
      );
    });

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="orbit globe"
      data-minimap="orbit"
      className="block cursor-grab touch-none select-none overflow-visible"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // A drag turns the globe; it never starts a text selection in the pane.
        event.preventDefault();
        const token = orbit.begin();
        if (!token) return;
        pressed.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
          token,
        };
      }}
      onPointerMove={(event) => {
        const start = pressed.current;
        if (!start || !orbit.owns(start.token)) return;
        if (
          !start.moved &&
          Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 3
        )
          return;
        if (!start.moved) event.currentTarget.setPointerCapture?.(event.pointerId);
        start.moved = true;
        const next = {
          ...start.token.from,
          // Absolute displacement survives multiple pointer events before React commits.
          yaw: start.token.from.yaw - (event.clientX - start.x) * DEG_PER_PX,
          elev: clampElev(start.token.from.elev + (event.clientY - start.y) * DEG_PER_PX),
        };
        orbit.preview(start.token, next);
      }}
      onPointerUp={() => {
        if (pressed.current) orbit.end(pressed.current.token);
        if (pressed.current) pressed.current.ended = true;
        // The click that follows a drag still needs to know it was one.
        const released = pressed.current;
        setTimeout(() => {
          if (pressed.current === released) pressed.current = null;
        });
      }}
      onPointerCancel={() => {
        if (pressed.current) orbit.cancel(pressed.current.token);
        pressed.current = null;
      }}
      onLostPointerCapture={() => {
        if (pressed.current && !pressed.current.ended) {
          orbit.cancel(pressed.current.token);
          pressed.current = null;
        }
      }}
    >
      <circle
        cx={C}
        cy={C}
        r={R}
        fill={tokenRef("page")}
        fillOpacity={0.88}
        stroke={tokenRef("line")}
      />
      <path
        d={body.far}
        pointerEvents="none"
        fill="none"
        stroke={tokenRef("ink-2")}
        strokeOpacity={0.25}
        strokeWidth={0.75}
      />
      {dots(false)}
      <g pointerEvents="none" data-orbit-mini="">
        {paint?.(body.at)}
      </g>
      <path
        d={body.near}
        pointerEvents="none"
        fill="none"
        stroke={tokenRef("ink-2")}
        strokeWidth={1}
      />
      {dots(true)}
      {body.rim.map((m) => (
        <g
          key={m.look}
          data-orbit-look={m.look}
          transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`}
          opacity={m.front ? 1 : 0.5}
          style={{ cursor: "pointer" }}
          onClick={() => {
            if (!pressed.current?.moved) glideLook(orbit, m.look);
          }}
        >
          <title>{m.look === "N" ? "Look north: the camera moves to the south" : "Look south: the camera moves to the north"}</title>
          <circle r={8} fill={tokenRef("page")} stroke={tokenRef("ink-2")} strokeWidth={1} />
          <text y={3.5} fontSize={10} textAnchor="middle" className="face-mono" fill={tokenRef("ink")} pointerEvents="none">
            {m.look}
          </text>
        </g>
      ))}
    </svg>
  );
}
