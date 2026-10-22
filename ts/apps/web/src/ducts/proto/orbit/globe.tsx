/**
 * THROWAWAY (protoui round 2): the globe navigator. Precedent: the Autodesk ViewCube Revit users
 * already know, as a wireframe sphere instead of a cube. One rigid body: the wire sphere and the
 * mini system inside it are both drawn through the canvas camera's own yaw and elevation, so they
 * turn together and exactly as the drawing turns; the viewer looks at the body from a fixed screen
 * direction. Three great circles (the plan, and the N-S and E-W vertical planes) carry the 6 poles
 * (N, S, E, W on project north = snapshot +Y, which `iso.tsx` does not re-derive; Up, Down) and 12
 * mid-arc points; a click glides the camera so that point faces the viewer. The compass, not the
 * group's grid, places the poles, so their words never lie (Project A runs 45° off north, so the
 * level mid-arc points land square to its ducts). Far-side wire and dots draw dim, behind the
 * system. Elevation stops at 0, so the points below the floor are drawn and refused.
 */
import { type ReactNode, useMemo, useRef } from "react";

import { token } from "@pe/kit/lib/token";
import { boxCentre, orbitProject, pointsOf, towards, type Orbit } from "./camera";

const SIZE = 220;
const C = SIZE / 2;
const R = 92;
const ARC_STEPS = 96;
const ZERO = [0, 0] as const;

type Vec = readonly [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The 18 orientations, as camera yaw (0 = the eye in the south) and elevation. */
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

export function Globe({ orbit }: { orbit: Orbit }) {
  const { yaw, elev, scene, pivot, stretch } = orbit;
  const pressed = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // The system's centre and a scale from its 3-D radius, so turning never resizes it.
  const mini = useMemo(() => {
    const all = pointsOf(scene, new Set());
    const points = all.length ? all : scene.context.flat().flatMap((s) => s.polyline);
    const centre = boxCentre(points) ?? [0, 0, 0];
    let radius = 1;
    for (const p of points)
      radius = Math.max(
        radius,
        Math.hypot(p[0]! - centre[0]!, p[1]! - centre[1]!, (p[2]! - centre[2]!) * stretch),
      );
    const lines = all.length
      ? scene.segments.map((f) => f.segment.polyline)
      : scene.context.flat().map((s) => s.polyline);
    return { centre, scale: (R * 0.8) / radius, lines };
  }, [scene, stretch]);

  // The body: the wire in unit-sphere space and the system in model space, one rotation for both.
  const body = useMemo(() => {
    const unit = orbitProject(yaw, elev, [0, 0, 0], ZERO, 1);
    const eye = towards(yaw, elev);
    const at = (v: Vec) => {
      const [x, y] = unit(v);
      return [C + x * R, C + y * R] as const;
    };
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
      const target = stop.rel;
      const v = towards(target ?? 0, stop.elev);
      const [x, y] = at(v);
      return { ...stop, target, v, x, y, front: dot(v, eye) >= -1e-9 };
    });

    const model = orbitProject(yaw, elev, mini.centre, ZERO, stretch);
    const to = (p: readonly number[]) => {
      const [x, y] = model(p);
      return [C + x * mini.scale, C + y * mini.scale] as const;
    };
    let d = "";
    for (const line of mini.lines)
      line.forEach((p, i) => {
        const [x, y] = to(p);
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      });
    return { near, far, stops, d, pivot: to(pivot) };
  }, [yaw, elev, mini, pivot, stretch]);

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
            orbit.goTo(stop.target, stop.elev);
          }}
        >
          <title>{stopTitle(stop.v, stop.elev)}</title>
          <circle r={9} fill="transparent" />
          <circle
            r={stop.pole ? 4 : 2.75}
            fill={below ? token("line") : token("page")}
            stroke={token("ink-2")}
            strokeWidth={1}
          />
          {label ? (
            <text
              x={lx}
              y={ly + 3.5}
              fontSize={10}
              textAnchor="middle"
              className="face-mono"
              fill={below ? token("ink-mute") : token("ink")}
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
      data-orbit-globe=""
      style={{
        cursor: "grab",
        touchAction: "none",
        overflow: "visible",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // A drag turns the globe; it never starts a text selection in the pane.
        event.preventDefault();
        pressed.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        const start = pressed.current;
        if (!start) return;
        if (!start.moved && Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 3)
          return;
        if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId);
        start.moved = true;
        orbit.drag(event.movementX, event.movementY);
      }}
      onPointerUp={() => {
        // The click that follows a drag still needs to know it was one.
        setTimeout(() => (pressed.current = null));
      }}
    >
      <circle cx={C} cy={C} r={R} fill={token("page")} fillOpacity={0.88} stroke={token("line")} />
      <path
        d={body.far}
        pointerEvents="none"
        fill="none"
        stroke={token("ink-2")}
        strokeOpacity={0.25}
        strokeWidth={0.75}
      />
      {dots(false)}
      <g pointerEvents="none" data-orbit-mini="">
        <path d={body.d} fill="none" stroke={token("ink-2")} strokeOpacity={0.75} strokeWidth={1} />
        <circle cx={body.pivot[0]} cy={body.pivot[1]} r={2.5} fill={token("ink")} data-orbit-pivot="" />
      </g>
      <path d={body.near} pointerEvents="none" fill="none" stroke={token("ink-2")} strokeWidth={1} />
      {dots(true)}
    </svg>
  );
}
