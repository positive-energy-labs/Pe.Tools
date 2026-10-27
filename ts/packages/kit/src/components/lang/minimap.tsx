import "./lang.css";
import { SvgTip } from "./tooltip";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { tokenRef } from "../../lib/token";

import type { OrbitViewport, PlaneViewport, ScrollViewport } from "@pe/agent-contracts";
export type { OrbitViewport, PlaneViewport, ScrollViewport };

import { glideLook, type LiveOrbit, type OrbitGesture } from "./live-orbit";

type ViewportHow = "gesture" | "move";

interface MinimapProps<V> {
  viewport: V;
  onViewport: (next: V, how: ViewportHow) => void;
}

type Size = { width: number; height: number };

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

const visibleRect = (v: PlaneViewport | ScrollViewport, size: Size) =>
  v.kind === "scroll"
    ? { x: v.left, y: v.top, width: size.width, height: size.height }
    : {
        x: -v.tx / v.scale,
        y: -v.ty / v.scale,
        width: size.width / v.scale,
        height: size.height / v.scale,
      };

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
      ((event.clientX - rect.left) / (rect.width || w)) * extent.width,
      ((event.clientY - rect.top) / (rect.height || h)) * extent.height,
      viewportSize,
      extent,
    );
  };
  return (
    <div
      className="relative"
      style={{
        width: `var(--floater-content-w, ${w}px)`,
        height: `var(--floater-content-h, ${h}px)`,
      }}
      data-minimap="plane"
    >
      <canvas
        ref={canvas}
        width={w}
        height={h}
        aria-label="field thumbnail; click to move the view"
        className="block size-full cursor-crosshair touch-none"
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
      <span
        aria-hidden
        data-minimap-viewport=""
        style={{
          left: `${(box.x / extent.width) * 100}%`,
          top: `${(box.y / extent.height) * 100}%`,
          width: `${(box.width / extent.width) * 100}%`,
          height: `${(box.height / extent.height) * 100}%`,
          minWidth: 4,
          minHeight: 4,
        }}
      />
    </div>
  );
}

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

/** Eye distance in globe radii when the camera is in perspective. ponytail: a fixed feel constant;
 * the real camera's distance changes all the time, and a gizmo reads better held still. */
const EYE = 3;
/** Scaled so the perspective silhouette lands on the drawn rim (radius `R`). */
const SILHOUETTE = Math.sqrt(EYE * EYE - 1);

type Projection = "perspective" | "parallel";

const globeProjection = (yaw: number, elev: number, projection: Projection) => {
  const cos = Math.cos(rad(yaw));
  const sin = Math.sin(rad(yaw));
  const sinE = Math.sin(rad(elev));
  const cosE = Math.cos(rad(elev));
  const eye = towards(yaw, elev);
  return (p: readonly number[]): [number, number] => {
    // Screen right is the camera's right; depth runs away from the eye.
    const depth = -(p[0]! * cos + p[1]! * sin);
    const k = projection === "parallel" ? 1 : SILHOUETTE / (EYE - dot(p as Vec, eye));
    return [C + (p[1]! * cos - p[0]! * sin) * R * k, C - (depth * sinE + p[2]! * cosE) * R * k];
  };
};

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
const bearing = (v: Vec, step: 45 | 90 = 45) => {
  const deg = ((((Math.atan2(v[0], v[1]) * 180) / Math.PI) % 360) + 360) % 360;
  return COMPASS[((Math.round(deg / step) * step) / 45) % 8]!;
};
const poleLabel = (v: Vec, elev: number) =>
  elev === 90 ? "Up" : elev === -90 ? "Down" : bearing(v, 90);
const stopTitle = (v: Vec, elev: number) =>
  elev === 90 ? "↑ plan" : elev < 0 ? "↓ floor" : `${bearing(v)} ${elev}°`;

export function globeBody(yaw: number, elev: number, projection: Projection = "perspective") {
  const at = globeProjection(yaw, elev, projection);
  const eye = towards(yaw, elev);
  // A perspective eye sees the sphere only up to its tangent cone, dot = 1/EYE, not the equator.
  const limb = projection === "parallel" ? -1e-9 : 1 / EYE - 1e-9;
  const circles = [
    (t: number): Vec => [Math.cos(t), Math.sin(t), 0],
    ...[0, 90].map((rel) => {
      const u = towards(rel, 0);
      return (t: number): Vec => [u[0] * Math.cos(t), u[1] * Math.cos(t), Math.sin(t)];
    }),
  ];
  let near = "";
  let far = "";
  for (const circle of circles)
    for (let i = 0; i < ARC_STEPS; i++) {
      const a = circle((i / ARC_STEPS) * 2 * Math.PI);
      const b = circle(((i + 1) / ARC_STEPS) * 2 * Math.PI);
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      const piece = `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (dot(a, eye) + dot(b, eye) >= 2 * limb) near += piece;
      else far += piece;
    }
  const stops = STOPS.map((stop) => {
    const v = towards(stop.rel ?? 0, stop.elev);
    const [x, y] = at(v);
    return { ...stop, v, x, y, front: dot(v, eye) >= limb };
  });
  // N rides the rim, just outside the wire, at project north (+y).
  const v: Vec = [0, 1, 0];
  const [x, y] = at(v);
  const out = Math.hypot(x - C, y - C);
  const k = out < 1 ? 0 : (R + 16) / out;
  const rim = {
    x: out < 1 ? C : C + (x - C) * k,
    y: out < 1 ? C - R - 16 : C + (y - C) * k,
    front: dot(v, eye) >= limb,
  };
  return { at, near, far, stops, rim };
}

export function OrbitMinimap({
  orbit,
  lines,
  litLines,
  selectedLines,
  children,
}: {
  orbit: LiveOrbit;
  lines?: readonly (readonly (readonly number[])[])[];
  /** Hover-lit lines, drawn heavy; selected lines get the `select` underlay, as on the schematic. */
  litLines?: readonly (readonly (readonly number[])[])[];
  selectedLines?: readonly (readonly (readonly number[])[])[];
  /** The camera's own verbs (projection, wiggle): one row in the globe's free lower corners. */
  children?: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const live = useRef(orbit);
  live.current = orbit;
  const { yaw, elev, projection } = orbit.read() ?? { yaw: 0, elev: 0, projection: undefined };
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
  const body = globeBody(yaw, elev, projection);

  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    let frame = 0;
    let orientation = "";
    const draw = () => {
      frame = 0;
      const pose = orbit.read() ?? { yaw: 0, elev: 0, projection: undefined };
      const key = `${pose.yaw.toFixed(3)},${pose.elev.toFixed(3)},${pose.projection}`;
      if (key === orientation) return;
      orientation = key;
      const body = globeBody(pose.yaw, pose.elev, pose.projection);
      for (const side of ["near", "far"] as const)
        root.querySelector(`[data-orbit-wire="${side}"]`)?.setAttribute("d", body[side]);
      for (const stop of body.stops) {
        const node = root.querySelector<SVGGElement>(
          `[data-orbit-stop="${stop.rel ?? "pole"}/${stop.elev}"]`,
        )!;
        node.setAttribute("transform", `translate(${stop.x.toFixed(1)} ${stop.y.toFixed(1)})`);
        node.setAttribute("opacity", stop.front ? "1" : "0.35");
        node.toggleAttribute("data-far", !stop.front);
        root.querySelector(`[data-orbit-stops="${stop.front ? "near" : "far"}"]`)!.append(node);
        const text = node.querySelector("text");
        if (text) {
          const out = Math.hypot(stop.x - C, stop.y - C);
          text.setAttribute("x", String(out < 4 ? 0 : ((stop.x - C) / out) * 12));
          text.setAttribute("y", String((out < 4 ? -10 : ((stop.y - C) / out) * 12) + 3.5));
        }
      }
      const rim = root.querySelector('[data-orbit-look="N"]')!;
      rim.setAttribute("transform", `translate(${body.rim.x.toFixed(1)} ${body.rim.y.toFixed(1)})`);
      rim.setAttribute("opacity", body.rim.front ? "1" : "0.5");
      const path = (lines: typeof litLines) =>
        (lines ?? [])
          .map((line) =>
            line
              .map(
                (point, i) =>
                  `${i ? "L" : "M"}${body
                    .at(point)
                    .map((v) => v.toFixed(1))
                    .join(" ")}`,
              )
              .join(""),
          )
          .join("");
      root.querySelector("[data-orbit-mini-lines]")!.setAttribute("d", path(lines));
      root.querySelector("[data-orbit-mini-reach]")!.setAttribute("d", path(litLines));
      root.querySelector("[data-orbit-mini-selected]")!.setAttribute("d", path(selectedLines));
    };
    draw();
    const release = orbit.subscribe(() => {
      frame ||= requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(frame);
      release();
    };
  }, [orbit, lines, litLines, selectedLines]);

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
            const viewport = live.current.read();
            if (viewport)
              live.current.move({ ...viewport, yaw: stop.rel ?? viewport.yaw, elev: stop.elev });
          }}
        >
          <SvgTip content={stopTitle(stop.v, stop.elev)} />
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

  // React owns this immutable SVG subtree; the camera subscriber owns its projected attributes.
  const [drawing] = useState(() => (
    <>
      <circle
        cx={C}
        cy={C}
        r={R}
        fill={tokenRef("page")}
        fillOpacity={0.88}
        stroke={tokenRef("line")}
      />
      <path
        data-orbit-wire="far"
        d={body.far}
        pointerEvents="none"
        fill="none"
        stroke={tokenRef("ink-2")}
        strokeOpacity={0.25}
        strokeWidth={0.75}
      />
      <g data-orbit-stops="far">{dots(false)}</g>
      <g pointerEvents="none" data-orbit-mini="">
        <path
          data-orbit-mini-selected=""
          fill="none"
          stroke={tokenRef("select")}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path data-orbit-mini-reach="" fill="none" stroke={tokenRef("ink")} strokeWidth={3.5} />
        <path
          data-orbit-mini-lines=""
          fill="none"
          stroke={tokenRef("ink-2")}
          strokeOpacity={0.75}
          strokeWidth={1.5}
        />
      </g>
      <path
        data-orbit-wire="near"
        d={body.near}
        pointerEvents="none"
        fill="none"
        stroke={tokenRef("ink-2")}
        strokeWidth={1}
      />
      <g data-orbit-stops="near">{dots(true)}</g>
      <g
        data-orbit-look="N"
        transform={`translate(${body.rim.x.toFixed(1)} ${body.rim.y.toFixed(1)})`}
        opacity={body.rim.front ? 1 : 0.5}
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (!pressed.current?.moved) glideLook(live.current);
        }}
      >
        <SvgTip content="N · look" />
        <circle r={8} fill={tokenRef("page")} stroke={tokenRef("ink-2")} strokeWidth={1} />
        <text
          y={3.5}
          fontSize={10}
          textAnchor="middle"
          className="face-mono"
          fill={tokenRef("ink")}
          pointerEvents="none"
        >
          N
        </text>
      </g>
    </>
  ));

  const box = {
    width: `var(--floater-content-w, ${SIZE}px)`,
    height: `var(--floater-content-h, ${SIZE}px)`,
  };
  const globe = (
    <svg
      ref={svg}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="orbit globe"
      data-minimap="orbit"
      className="block cursor-grab touch-none select-none overflow-visible"
      style={children ? { width: "100%", height: "100%" } : box}
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
        orbit.notify();
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
      {drawing}
    </svg>
  );
  return children ? (
    <div className="relative" style={box}>
      {globe}
      <div
        data-orbit-controls=""
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 *:pointer-events-auto"
      >
        {children}
      </div>
    </div>
  ) : (
    globe
  );
}
