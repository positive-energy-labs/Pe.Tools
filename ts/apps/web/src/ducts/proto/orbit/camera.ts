/**
 * THROWAWAY (protoui round 1-2): the orbit camera for the isometric. Elevation is camera state in
 * [0, 90] beside yaw (snapping at plan 90, iso 30, elevation 0); the pivot follows the selection
 * and the drawing translates so the new pivot stays where it was on screen. The camera rides the
 * `project` function it builds (`orbitOf`): the variants hand DuctDrawing only `project`, so that
 * is the one channel that reaches the drawing without touching their files (a shim).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { boundsOf, type Bounds2, type Point2 } from "#/lib/affine-frame";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";
import type { Scene } from "../../drawing";
import type { DuctIndex } from "../../scene";

/** The lens is one toggle: `run` on or off (round 2 killed `spot`). */
export type LensMode = "off" | "run";
const DEG_PER_PX = 0.4;
const SNAPS = [90, 30, 0] as const;
const SNAP_DEG = 3;
const GLIDE_MS = 150;
/** A framed selection is never smaller than this many feet across, so one fitting is not 400x. */
const FRAME_MIN_FT = 12;
const ZERO: Point2 = [0, 0];

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp = (v: number) => Math.min(90, Math.max(0, v));
const snap = (raw: number) => SNAPS.find((s) => Math.abs(raw - s) < SNAP_DEG) ?? raw;

/** The orthographic projection at `yaw`/`elev` degrees about `pivot`, shifted by `offset` drawing feet. */
export const orbitProject = (
  yaw: number,
  elev: number,
  pivot: readonly number[],
  offset: Point2,
  stretch: number,
) => {
  const cos = Math.cos(rad(yaw));
  const sin = Math.sin(rad(yaw));
  const sinE = Math.sin(rad(elev));
  const cosE = Math.cos(rad(elev));
  return (point: readonly number[]): Point2 => {
    const x = point[0]! - pivot[0]!;
    const y = point[1]! - pivot[1]!;
    const z = (point[2]! - pivot[2]!) * stretch;
    const depth = x * sin + y * cos;
    return [x * cos - y * sin + offset[0], -(depth * sinE + z * cosE) + offset[1]];
  };
};

/** The unit vector from the pivot to the eye of a camera at `yaw`/`elev` degrees. */
export const towards = (yaw: number, elev: number): [number, number, number] => {
  const cosE = Math.cos(rad(elev));
  return [-Math.sin(rad(yaw)) * cosE, -Math.cos(rad(yaw)) * cosE, Math.sin(rad(elev))];
};

/** The 3-D bbox centre of model points; null for none. */
export const boxCentre = (points: readonly (readonly number[])[]) => {
  if (!points.length) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p[i]!);
      hi[i] = Math.max(hi[i]!, p[i]!);
    }
  return lo.map((v, i) => (v + hi[i]!) / 2);
};

/** Every model point of the scene elements in `ids`; all of them when `ids` is empty. */
export const pointsOf = (scene: Scene, ids: ReadonlySet<number>) => {
  const all = ids.size === 0;
  return [
    ...scene.segments.flatMap((f) => (all || ids.has(f.segment.id) ? f.segment.polyline : [])),
    ...scene.nodes.flatMap((f) => (all || ids.has(f.node.id) ? [f.node.point] : [])),
  ];
};

export interface Orbit {
  yaw: number;
  elev: number;
  pivot: readonly number[];
  stretch: number;
  scene: Scene;
  project: (point: readonly number[]) => Point2;
  lens: LensMode;
  setLens: (mode: LensMode) => void;
  /** Screen px of pointer motion: x turns yaw, y tilts elevation (down raises the eye). */
  drag: (dx: number, dy: number) => void;
  /** Glide to an orientation; `yaw` null keeps the current yaw (a pole has none). */
  goTo: (yaw: number | null, elev: number) => void;
  /** Re-pivot on these elements' bbox centre (the subject's centre when empty), without a jump. */
  follow: (ids: ReadonlySet<number>) => void;
  /** Ask the drawing to fit these elements (all of them when empty). */
  frame: (ids: ReadonlySet<number>) => void;
  /** The last frame request, in drawing feet. */
  fitTo: { key: number; box: Bounds2 } | null;
  /** Each run's element ids (root to terminal), for the run lens. */
  runs: readonly (readonly number[])[];
}

const registry = new WeakMap<object, Orbit>();
/** The orbit camera that built `project`, or null for every other projection. */
export const orbitOf = (project: object): Orbit | null => registry.get(project) ?? null;

/** The globe camera: the isometric's one camera. */
export function useOrbit(
  o: {
    index: DuctIndex;
    group: string;
    scene: Scene;
    grid: number;
    basePivot: readonly number[];
    stretch: number;
    turned: number;
    setTurned: (next: number | ((t: number) => number)) => void;
  },
): Orbit {
  const [elev, setElev] = useState(30);
  const raw = useRef(30);
  const [focus, setFocus] = useState<{ pivot: readonly number[]; offset: Point2 } | null>(null);
  const [fitTo, setFitTo] = useState<Orbit["fitTo"]>(null);
  const [lens, setLens] = useState<LensMode>("off");
  const pending = useRef({ dx: 0, dy: 0, frame: 0 });
  const glide = useRef(0);
  const followed = useRef("");

  // A new subject drops the selection pivot.
  useEffect(() => {
    setFocus(null);
    followed.current = "";
  }, [o.basePivot]);

  const yaw = 45 - o.grid + o.turned;
  const pivot = focus?.pivot ?? o.basePivot;
  const offset = focus?.offset ?? ZERO;
  const project = useMemo(
    () => orbitProject(yaw, elev, pivot, offset, o.stretch),
    [yaw, elev, pivot, offset, o.stretch],
  );
  const runs = useMemo(
    () => (o.group ? runsOf(groupTree(o.index.snapshot, o.group)).map((r) => r.path) : []),
    [o.index, o.group],
  );

  const setElevation = (value: number) => {
    raw.current = clamp(value);
    setElev(snap(raw.current));
  };
  const orbit: Orbit = {
    yaw,
    elev,
    pivot,
    stretch: o.stretch,
    scene: o.scene,
    project,
    lens,
    setLens,
    runs,
    fitTo,
    drag: (dx, dy) => {
      cancelAnimationFrame(glide.current);
      // Coalesced to one move per frame, however fast the pointer reports.
      pending.current.dx += dx;
      pending.current.dy += dy;
      if (!pending.current.frame)
        pending.current.frame = requestAnimationFrame(() => {
          const { dx: x, dy: y } = pending.current;
          pending.current = { dx: 0, dy: 0, frame: 0 };
          o.setTurned((t) => t + x * DEG_PER_PX);
          setElevation(raw.current + y * DEG_PER_PX);
        });
    },
    goTo: (target, toElev) => {
      cancelAnimationFrame(glide.current);
      const turned0 = o.turned;
      const elev0 = elev;
      const by = target == null ? 0 : ((((target - yaw) % 360) + 540) % 360) - 180;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - start) / GLIDE_MS));
        const k = 1 - (1 - t) ** 3;
        o.setTurned(turned0 + by * k);
        raw.current = elev0 + (toElev - elev0) * k;
        setElev(raw.current);
        if (t < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    },
    follow: (ids) => {
      const key = [...ids].sort((a, b) => a - b).join(",");
      if (key === followed.current) return;
      followed.current = key;
      const next = (ids.size ? boxCentre(pointsOf(o.scene, ids)) : null) ?? o.basePivot;
      if (next.every((v, i) => v === pivot[i])) return;
      // The new pivot keeps its current screen spot: the offset is where it projects now.
      setFocus({ pivot: next, offset: project(next) });
    },
    frame: (ids) => {
      const points = pointsOf(o.scene, ids).map(project);
      if (!points.length) return;
      const box = boundsOf(points);
      const padX = Math.max(0, FRAME_MIN_FT - (box.maxX - box.minX)) / 2;
      const padY = Math.max(0, FRAME_MIN_FT - (box.maxY - box.minY)) / 2;
      setFitTo({
        key: (fitTo?.key ?? 0) + 1,
        box: {
          minX: box.minX - padX,
          maxX: box.maxX + padX,
          minY: box.minY - padY,
          maxY: box.maxY + padY,
        },
      });
    },
  };
  registry.set(project, orbit);
  return orbit;
}
