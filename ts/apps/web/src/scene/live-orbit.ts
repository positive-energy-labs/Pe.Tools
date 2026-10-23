import { useLayoutEffect, useRef, useState } from "react";
import { fitDistance, ORBIT_FOV, type OrbitViewport } from "./orbit";
import type { Bounds } from "./types";

type Move = "gesture" | "move";
export type OrbitGesture = { readonly from: OrbitViewport };
const equal = (a: OrbitViewport | null, b: OrbitViewport | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.yaw === b.yaw &&
    a.elev === b.elev &&
    a.zoom === b.zoom &&
    a.pivot.every((v, i) => v === b.pivot[i]));

/** One live pose shared by the canvas and its controls. Page persists only the released pose:
 * publishing each frame through Page previously reran the whole route (918 ms orbit gaps).
 * A gesture token prevents a cancelled/replaced gesture from overwriting an external move. */
export function createLiveOrbit(
  initial: OrbitViewport | null,
  commit: (v: OrbitViewport, how: Move) => void,
) {
  let value = initial;
  let pending: OrbitViewport[] = [];
  const publish = (pose: OrbitViewport, how: Move) => {
    pending.push(pose);
    commit(pose, how);
  };
  let gesture: OrbitGesture | null = null;
  const listeners = new Set<() => void>();
  const update = (next: OrbitViewport | null) => {
    if (equal(value, next)) return;
    value = next;
    listeners.forEach((notify) => notify());
  };
  return {
    read: () => value,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    /** Wake subscribers without a new pose: a flight has ended, so held views read the live one. */
    notify: () => listeners.forEach((notify) => notify()),
    begin: (): OrbitGesture | null => (gesture = value ? { from: value } : null),
    owns: (token: OrbitGesture | null) => token !== null && gesture === token,
    preview(token: OrbitGesture | null, next: OrbitViewport) {
      if (token && gesture === token) update(next);
    },
    /** `how` null: the pose the move landed on is already the Page's (a history restore). */
    end(token: OrbitGesture | null, how: Move | null = "gesture") {
      if (!token || gesture !== token) return;
      gesture = null;
      if (how && value && !equal(value, token.from)) publish(value, how);
    },
    cancel(token: OrbitGesture | null) {
      if (!token || gesture !== token) return;
      gesture = null;
      update(token.from);
    },
    move(next: OrbitViewport) {
      gesture = null;
      update(next);
      publish(next, "move");
    },
    /** An external Page pose. `fly`, when given and both poses exist, travels there instead of jumping. */
    accept(next: OrbitViewport | null, fly?: (to: OrbitViewport) => void) {
      const echo = pending.findIndex((pose) => equal(pose, next));
      if (echo >= 0) {
        pending.splice(0, echo + 1);
        return;
      }
      pending = [];
      if (fly && value && next && !equal(value, next)) return fly(next);
      gesture = null;
      update(next);
    },
    restore(next: OrbitViewport | null) {
      pending = [];
      gesture = null;
      update(next);
    },
  };
}
export type LiveOrbit = ReturnType<typeof createLiveOrbit>;

const flights = new WeakMap<LiveOrbit, OrbitGesture>();
/** True while a flight owns the camera. Views that cost a React render per frame (the DOM
 * annotation layer) hold their last pose until `notify` at the landing or interruption. */
export const isFlying = (orbit: LiveOrbit) => orbit.owns(flights.get(orbit) ?? null);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const turn = (from: number, to: number) => ((to - from + 540) % 360) - 180;

export type Flight = {
  /** How the landing lands in history: push a named move, replace (merge into the entry the
   * move answers), or null when the Page already holds the pose (Back, Forward, a Pea patch). */
  history?: "push" | "replace" | null;
  /** The bounds the camera is built on (`toCamera`): a long hop rises to show both ends. */
  scene?: Bounds | null;
  /** Called once on landing, never when interrupted. */
  onLand?: () => void;
};

/**
 * Travel to a pose: eased in and out, the shortest yaw, no roll. A hop longer than the view rises
 * mid-flight until origin and destination share the frame (a van Wijk zoom, cut to a sine), so
 * the eye keeps its place. Any gesture or newer move takes the orbit and ends it at once; a newer
 * flight retargets from where this one is, leaving at speed rather than restarting from rest.
 */
export function flyTo(orbit: LiveOrbit, to: OrbitViewport, flight: Flight = {}) {
  const from = orbit.read();
  const retarget = orbit.owns(flights.get(orbit) ?? null);
  const token = orbit.begin();
  if (!from || !token) return;
  flights.set(orbit, token);
  const yaw = turn(from.yaw, to.yaw);
  const travel = Math.hypot(...to.pivot.map((v, i) => v - from.pivot[i]!));
  // At zoom z the view's half-height is radius / z feet. Both ends sit 0.5 travel from the
  // midpoint; 0.65 keeps a margin. Never wider than the whole scene unless an end already is.
  const z0 = Math.log(from.zoom),
    z1 = Math.log(to.zoom);
  const radius = flight.scene ? fitDistance(flight.scene) * Math.sin((ORBIT_FOV / 2) * (Math.PI / 180)) : 0;
  const reach = radius && travel ? Math.log(radius / (0.65 * travel)) : Infinity;
  const rise = Math.max(0, (z0 + z1) / 2 - Math.max(reach, Math.min(0, z0, z1)));
  const ms = 380 + Math.min(140, rise * 90) + Math.min(60, Math.abs(yaw) / 2);
  const ease = retarget ? easeOut : easeInOut;
  const how = flight.history === undefined ? "move" : flight.history && (flight.history === "push" ? "move" : "gesture");
  // Time advances at most two frames per frame: a main-thread stall delays the flight, never
  // skips it, so the eye still sees the travel that tells it where it went.
  let elapsed = 0;
  let last: number | null = null;
  requestAnimationFrame(function step(at) {
    if (!orbit.owns(token)) return void (isFlying(orbit) || orbit.notify());
    elapsed += last === null ? 0 : Math.min(at - last, 34);
    last = at;
    const t = Math.min(elapsed / ms, 1);
    const k = ease(t);
    orbit.preview(
      token,
      t === 1
        ? to
        : {
            kind: "orbit",
            yaw: from.yaw + yaw * k,
            elev: from.elev + (to.elev - from.elev) * k,
            zoom: Math.exp(z0 + (z1 - z0) * k - rise * Math.sin(Math.PI * k)),
            pivot: from.pivot.map((v, i) => v + (to.pivot[i]! - v) * k) as OrbitViewport["pivot"],
          },
    );
    if (t < 1) return void requestAnimationFrame(step);
    orbit.end(token, how);
    orbit.notify();
    flight.onLand?.();
  });
}

// Camera yaw looking north: the eye sits on the opposite side of the pivot (yaw 0 = eye on +X,
// 90 = eye on +Y), so looking north is the eye at 270.
// ponytail: north is project north (+Y). No true-north or project-north angle reaches the web scene
// (the capture's SceneMeshes carry bounds and instances only); when one does, rotate the yaw by it here.
const NORTH_YAW = 270;

/** Turn to look north (elevation, zoom and pivot kept), released as a gesture so Page's viewport
 * is replaced. A newer gesture or move takes the orbit and ends it. */
export function glideLook(orbit: LiveOrbit) {
  const now = orbit.read();
  if (now) flyTo(orbit, { ...now, yaw: NORTH_YAW }, { history: "replace" });
}

/** Scope changes (system, document, view mode) cancel gestures even if the saved pose is equal.
 * pageValue is the actual Page key, distinct from a derived fit. Its identity detects explicit
 * external moves even to the same saved pose; rebuilding an equal fit is not such a move.
 * Delayed acknowledgements of our commits must not reset a newer gesture. */
export function useLiveOrbit(
  pose: OrbitViewport | null,
  commit: (v: OrbitViewport, how: Move) => void,
  scope: unknown,
  pageValue: unknown = pose,
  scene?: Bounds | null,
  /** Called once when the next external flight lands (the caller's jump marks), then cleared. */
  landing?: { current: (() => void) | null },
) {
  const latest = useRef(commit);
  latest.current = commit;
  const [orbit] = useState(() => createLiveOrbit(pose, (v, how) => latest.current(v, how)));
  const previous = useRef({ pose, scope, pageValue });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useLayoutEffect(() => {
    if (previous.current.scope !== scope) orbit.restore(pose);
    else if (previous.current.pageValue !== pageValue || !equal(previous.current.pose, pose))
      // An external pose (Back, Forward, Pea) travels; the Page already holds it, so no commit.
      orbit.accept(pose, (to) =>
        flyTo(orbit, to, {
          history: null,
          scene: sceneRef.current,
          onLand: () => {
            const land = landing?.current;
            if (landing) landing.current = null;
            land?.();
          },
        }),
      );
    previous.current = { pose, scope, pageValue };
  }, [orbit, pose, scope, pageValue]);
  return orbit;
}
