import { viewportCodec } from "@pe/agent-contracts";
import { useLayoutEffect, useRef, useState } from "react";
import type { OrbitViewport } from "@pe/agent-contracts";
type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

type Move = "gesture" | "move";
export type OrbitGesture = {
  readonly from: OrbitViewport;
  readonly height: number;
  readonly span: number;
};
const equal = (a: OrbitViewport | null, b: OrbitViewport | null) =>
  a === b ||
  (!!a &&
    !!b &&
    (a.projection ?? "perspective") === (b.projection ?? "perspective") &&
    a.yaw === b.yaw &&
    a.elev === b.elev &&
    a.zoom === b.zoom &&
    a.pivot.every((v, i) => v === b.pivot[i]));

// Page's URL echo is rounded by the public codec. It acknowledges the same move; it must not
// start another flight or cancel input that began after publication. Live previews stay exact.
const samePage = (a: OrbitViewport | null, b: OrbitViewport | null) =>
  equal(a, b) || (!!a && !!b && viewportCodec.encode(a) === viewportCodec.encode(b));

/** Publish only released poses: per-frame Page writes rerendered the route in 918 ms gaps. */
export function createLiveOrbit(
  initial: OrbitViewport | null,
  commit: (v: OrbitViewport, how: Move) => void,
) {
  let value = initial;
  let published = initial;
  let pending: OrbitViewport[] = [];
  const publish = (pose: OrbitViewport, how: Move) => {
    if (equal(published, pose)) return;
    published = pose;
    pending.push(pose);
    commit(pose, how);
  };
  let gesture: OrbitGesture | null = null;
  let constraint: ((pose: OrbitViewport) => OrbitViewport) | null = null;
  const constrained = (pose: OrbitViewport | null) => pose && (constraint?.(pose) ?? pose);
  const listeners = new Set<() => void>();
  const update = (next: OrbitViewport | null) => {
    next = constrained(next);
    if (equal(value, next)) return false;
    value = next;
    listeners.forEach((notify) => notify());
    return true;
  };
  return {
    read: () => value,
    moving: () => gesture !== null,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    /** Wake subscribers without a new pose: a flight has ended, so held views read the live one. */
    notify: () => {
      if (!update(value)) listeners.forEach((notify) => notify());
    },
    /** The mounted picture owns camera policy; every gesture, flight and Page restore shares it. */
    constrain(limit: (pose: OrbitViewport) => OrbitViewport) {
      constraint = limit;
      update(value);
      return () => {
        if (constraint === limit) constraint = null;
      };
    },
    begin: (height = 600, span = 2 / (value?.zoom ?? 1)): OrbitGesture | null =>
      (gesture = value ? { from: value, height: Math.max(height, 1), span } : null),
    owns: (token: OrbitGesture | null) => token !== null && gesture === token,
    preview(token: OrbitGesture | null, next: OrbitViewport) {
      if (token && gesture === token) update(next);
    },
    /** `how` null: the pose the move landed on is already the Page's (a history restore). */
    end(token: OrbitGesture | null, how: Move | null = "gesture") {
      if (!token || gesture !== token) return;
      gesture = null;
      if (!how || !value || equal(value, token.from)) return;
      const from = token.from;
      // Three screen pixels or half a percent zoom: a click's controls nudge is not navigation.
      const moved =
        Math.max(
          (Math.abs(((value.yaw - from.yaw + 540) % 360) - 180) * token.height) / 360,
          (Math.abs(value.elev - from.elev) * token.height) / 360,
          (Math.hypot(...value.pivot.map((v, i) => v - from.pivot[i]!)) * token.height) /
            token.span,
        ) >= 3 || Math.abs(Math.log(value.zoom / from.zoom)) >= 0.005;
      if (how === "move" || moved || value.projection !== from.projection) publish(value, how);
      else update(from);
    },
    cancel(token: OrbitGesture | null) {
      if (!token || gesture !== token) return;
      gesture = null;
      update(token.from);
    },
    move(next: OrbitViewport, how: Move = "move") {
      next = constrained(next)!;
      gesture = null;
      update(next);
      publish(next, how);
    },
    /** An external Page pose. `fly`, when given and both poses exist, travels there instead of jumping. */
    accept(next: OrbitViewport | null, fly?: (to: OrbitViewport) => void) {
      next = constrained(next);
      const echo = pending.findIndex((pose) => samePage(pose, next));
      if (echo >= 0) {
        pending.splice(0, echo + 1);
        return;
      }
      pending = [];
      if (samePage(value, next)) return;
      published = next;
      if (fly && value && next && !equal(value, next)) return fly(next);
      gesture = null;
      update(next);
    },
    restore(next: OrbitViewport | null) {
      next = constrained(next);
      pending = [];
      published = next;
      gesture = null;
      update(next);
    },
  };
}
export type LiveOrbit = ReturnType<typeof createLiveOrbit>;

const flights = new WeakMap<LiveOrbit, OrbitGesture>();
/** Costly DOM views hold their last pose until a flight lands or is interrupted. */
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

/** Long hops rise to keep both ends visible; retargeting keeps the current speed. */
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
  const radius = flight.scene
    ? Math.max(
        Math.hypot(
          flight.scene.maxX - flight.scene.minX,
          flight.scene.maxY - flight.scene.minY,
          flight.scene.maxZ - flight.scene.minZ,
        ) / 2,
        0.5,
      )
    : 0;
  const reach = radius && travel ? Math.log(radius / (0.65 * travel)) : Infinity;
  const rise = Math.max(0, (z0 + z1) / 2 - Math.max(reach, Math.min(0, z0, z1)));
  const ms = 380 + Math.min(140, rise * 90) + Math.min(60, Math.abs(yaw) / 2);
  const ease = retarget ? easeOut : easeInOut;
  const how =
    flight.history === undefined
      ? "move"
      : flight.history && (flight.history === "push" ? "move" : "gesture");
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
            ...from,
            yaw: from.yaw + yaw * k,
            elev: from.elev + (to.elev - from.elev) * k,
            zoom: Math.exp(z0 + (z1 - z0) * k - rise * Math.sin(Math.PI * k)),
            pivot: from.pivot.map((v, i) => v + (to.pivot[i]! - v) * k) as OrbitViewport["pivot"],
          },
    );
    if (t < 1) return void requestAnimationFrame(step);
    orbit.end(token, null);
    if (how) orbit.move(to, how);
    orbit.notify();
    flight.onLand?.();
  });
}

// Camera yaw looking north: the eye sits on the opposite side of the pivot (yaw 0 = eye on +X,
// 90 = eye on +Y), so looking north is the eye at 270.
// ponytail: north is project north (+Y). No true-north or project-north angle reaches the web scene
// (the capture's SceneMeshes carry bounds and instances only); when one does, rotate the yaw by it here.
const NORTH_YAW = 270;

/** Look north is a named move. A newer gesture or move takes the orbit and ends it. */
export function glideLook(orbit: LiveOrbit) {
  const now = orbit.read();
  if (now) flyTo(orbit, { ...now, yaw: NORTH_YAW });
}

export type Wiggle = {
  /** Cone half-angle around the current view direction, degrees. Angular, so zoom-independent. */
  deg: number;
  /** One loop of the cone, milliseconds. */
  loopMs: number;
  loops: number;
  /** prefers-reduced-motion: one slow loop instead of the configured ones. */
  reduced?: boolean;
};
const wiggles = new WeakMap<LiveOrbit, () => void>();
const INTERRUPTS = ["pointerdown", "wheel", "keydown"] as const;

/**
 * A temporary parallax loop: the eye traces a small cone about the orbit target, eased in and out,
 * then returns to EXACTLY the start pose. It is a gesture that is always cancelled, so it never
 * publishes (no history, no address) and never touches selection. Any pointer, wheel or key input
 * outside `[data-wiggle]` restores the start pose before that input acts. A second call while one
 * runs stops it, restoring the start pose. Returns whether a wiggle started.
 */
export function wiggle(orbit: LiveOrbit, w: Wiggle): boolean {
  const running = wiggles.get(orbit);
  if (running) {
    running();
    return false;
  }
  const token = orbit.begin();
  if (!token) return false;
  const from = token.from;
  const loopMs = w.reduced ? w.loopMs * 1.5 : w.loopMs;
  const total = loopMs * (w.reduced ? 1 : Math.max(1, Math.round(w.loops)));
  // The radius eases in over the first and out over the last quarter loop.
  const ramp = Math.min(loopMs / 4, total / 2);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  // Yaw degrees shrink toward the poles; divide so the cone stays round on screen.
  const yawScale = 1 / Math.max(Math.cos((from.elev * Math.PI) / 180), 0.25);
  let frame = 0;
  const release = () => {
    cancelAnimationFrame(frame);
    wiggles.delete(orbit);
    for (const type of INTERRUPTS) window.removeEventListener(type, interrupt, true);
  };
  const stop = () => {
    release();
    orbit.cancel(token);
  };
  const interrupt = (event: Event) => {
    if ((event.target as Element | null)?.closest?.("[data-wiggle]")) return;
    // The wiggle's own hotkey toggles it through its binding.
    if (event instanceof KeyboardEvent && event.key.toLowerCase() === "w" && !event.ctrlKey) return;
    stop();
  };
  for (const type of INTERRUPTS)
    window.addEventListener(type, interrupt, { capture: true, passive: true });
  wiggles.set(orbit, stop);
  const started = performance.now();
  frame = requestAnimationFrame(function step(at) {
    // A newer gesture or flight took the orbit: it owns the pose now.
    if (!orbit.owns(token)) return release();
    const t = at - started;
    if (t >= total) return stop();
    const radius = w.deg * smooth(Math.max(0, Math.min(1, t / ramp, (total - t) / ramp)));
    const theta = (2 * Math.PI * t) / loopMs;
    orbit.preview(token, {
      ...from,
      yaw: from.yaw + radius * Math.cos(theta) * yawScale,
      elev: Math.min(89, Math.max(-89, from.elev + radius * Math.sin(theta))),
    });
    frame = requestAnimationFrame(step);
  });
  return true;
}

/** Scope and Page identity cancel gestures; acknowledgements never reset newer input. */
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
