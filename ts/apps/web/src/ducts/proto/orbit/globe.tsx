/**
 * THROWAWAY (protoui round 1): the globe navigator. Precedent: the Autodesk ViewCube Revit users
 * already know, as a wireframe sphere instead of a cube. Three great circles (the plan, and the
 * two vertical planes on the group's grid) cut it into six slices; the 6 poles and the 12 mid-arc
 * points are orientations a click glides to. The globe itself holds still; the needle is the eye,
 * and it moves as the canvas turns. Inside, the system in the camera's own view, with the pivot.
 * Elevation stops at 0, so the five points below the floor are drawn and refused.
 */
import { useMemo, useRef } from "react";

import { token } from "@pe/kit/lib/token";
import { boxCentre, orbitProject, pointsOf, towards, type Orbit } from "./camera";

const SIZE = 120;
const C = SIZE / 2;
const R = 52;
/** The globe's own fixed view, relative to the grid: a little off the iso corner, a little above. */
const VIEW_YAW = 20;
const VIEW_ELEV = 25;
const ARC_STEPS = 72;
const ZERO = [0, 0] as const;

type Vec = readonly [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The 18 orientations, as yaw relative to the grid and elevation. */
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
/** Where the eye stands, as a compass word: the bearing of its plan direction from model north (+y). */
const bearing = (v: Vec) => {
  const deg = (Math.atan2(v[0], v[1]) * 180) / Math.PI;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
};

const stopTitle = (v: Vec, elev: number) =>
  elev === 90
    ? "plan: the north pole, looking straight down"
    : elev < 0
      ? "below the floor: elevation stops at 0°"
      : elev === 0
        ? `elevation from the ${bearing(v)}, level with the model`
        : `from the ${bearing(v)}, ${elev}° above`;

export function Globe({ orbit }: { orbit: Orbit }) {
  const { yaw, elev, grid, scene, pivot, stretch } = orbit;
  const pressed = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const view = useMemo(() => {
    const yawG = VIEW_YAW - grid;
    const project = orbitProject(yawG, VIEW_ELEV, [0, 0, 0], ZERO, 1);
    const eye = towards(yawG, VIEW_ELEV);
    const at = (v: Vec) => {
      const [x, y] = project(v);
      return [C + x * R, C + y * R] as const;
    };
    const up: Vec = [0, 0, 1];
    const circles = [
      (t: number): Vec => [Math.cos(t), Math.sin(t), 0],
      ...[0, 90].map((rel) => {
        const u = towards(rel - grid, 0);
        return (t: number): Vec => [
          u[0] * Math.cos(t),
          u[1] * Math.cos(t),
          up[2] * Math.sin(t),
        ];
      }),
    ];
    // Each circle is two paths: the near half solid, the far half faint.
    const arcs = circles.map((circle) => {
      let near = "";
      let far = "";
      for (let i = 0; i < ARC_STEPS; i++) {
        const a = circle((i / ARC_STEPS) * 2 * Math.PI);
        const b = circle(((i + 1) / ARC_STEPS) * 2 * Math.PI);
        const [x1, y1] = at(a);
        const [x2, y2] = at(b);
        const piece = `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
        if (dot(a, eye) + dot(b, eye) >= 0) near += piece;
        else far += piece;
      }
      return { near, far };
    });
    const stops = STOPS.map((stop) => {
      const target = stop.rel == null ? null : stop.rel - grid;
      const v = towards(target ?? 0, stop.elev);
      const [x, y] = at(v);
      return { ...stop, target, v, x, y, front: dot(v, eye) >= 0 };
    });
    return { at, eye, arcs, stops };
  }, [grid]);

  // The system in the camera's view, scaled by its 3-D radius so turning never resizes it.
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
    return { centre, scale: (R * 0.72) / radius, lines: all.length ? scene.segments.map((f) => f.segment.polyline) : scene.context.flat().map((s) => s.polyline) };
  }, [scene, stretch]);
  const system = useMemo(() => {
    const project = orbitProject(yaw, elev, mini.centre, ZERO, stretch);
    const to = (p: readonly number[]) => {
      const [x, y] = project(p);
      return `${(C + x * mini.scale).toFixed(1)} ${(C + y * mini.scale).toFixed(1)}`;
    };
    let d = "";
    for (const line of mini.lines) line.forEach((p, i) => (d += `${i ? "L" : "M"}${to(p)}`));
    const [px, py] = project(pivot);
    return { d, pivot: [C + px * mini.scale, C + py * mini.scale] as const };
  }, [mini, yaw, elev, pivot, stretch]);

  const eyeNow = towards(yaw, elev);
  const [mx, my] = view.at(eyeNow);
  const markerFront = dot(eyeNow, view.eye) >= 0;

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="orbit globe"
      data-orbit-globe=""
      style={{ cursor: "grab", touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
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
      <defs>
        <clipPath id="orbit-globe-clip">
          <circle cx={C} cy={C} r={R} />
        </clipPath>
      </defs>
      <circle cx={C} cy={C} r={R} fill={token("page")} fillOpacity={0.88} stroke={token("line")} />
      <g clipPath="url(#orbit-globe-clip)" pointerEvents="none" data-orbit-mini="">
        <path d={system.d} fill="none" stroke={token("ink-2")} strokeOpacity={0.7} strokeWidth={1} />
        <circle cx={system.pivot[0]} cy={system.pivot[1]} r={2} fill={token("ink-2")} />
      </g>
      {view.arcs.map((arc, i) => (
        <g key={i} pointerEvents="none" fill="none" stroke={token("ink-2")}>
          <path d={arc.far} strokeOpacity={0.3} strokeWidth={0.75} />
          <path d={arc.near} strokeWidth={1} />
        </g>
      ))}
      {view.stops.map((stop, i) => {
        const below = stop.elev < 0;
        const title = stopTitle(stop.v, stop.elev);
        return (
          <g
            key={i}
            data-orbit-stop={`${stop.rel ?? "pole"}/${stop.elev}`}
            data-refused={below ? "" : undefined}
            transform={`translate(${stop.x} ${stop.y})`}
            style={{ cursor: below ? "not-allowed" : "pointer" }}
            onClick={() => {
              if (below || pressed.current?.moved) return;
              orbit.goTo(stop.target, stop.elev);
            }}
          >
            <title>{title}</title>
            <circle r={8} fill="transparent" />
            {below ? (
              <circle r={1.25} fill={token("ink-mute")} />
            ) : (
              <circle
                r={stop.pole ? 3.5 : 2.5}
                fill={stop.front ? token("page") : token("line")}
                stroke={token("ink-2")}
                strokeWidth={1}
                strokeOpacity={stop.front ? 1 : 0.5}
              />
            )}
            {stop.pole && stop.elev === 0 && stop.front ? (
              <text
                x={((stop.x - C) / R) * 10}
                y={((stop.y - C) / R) * 10 + 3}
                fontSize={8}
                textAnchor="middle"
                className="face-mono"
                fill={token("ink-2")}
                pointerEvents="none"
              >
                {bearing(stop.v)}
              </text>
            ) : null}
          </g>
        );
      })}
      <g pointerEvents="none" data-orbit-eye="">
        <line
          x1={C}
          y1={C}
          x2={mx}
          y2={my}
          stroke={token("ink")}
          strokeWidth={1.5}
          strokeOpacity={markerFront ? 1 : 0.4}
        />
        <circle
          cx={mx}
          cy={my}
          r={4.5}
          fill={token("ink")}
          fillOpacity={markerFront ? 1 : 0.4}
          stroke={token("page")}
          strokeWidth={1.5}
        />
      </g>
    </svg>
  );
}
