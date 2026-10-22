import { useLayoutEffect, useRef, useState } from "react";
import type { OrbitViewport } from "./orbit";

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
    begin: (): OrbitGesture | null => (gesture = value ? { from: value } : null),
    owns: (token: OrbitGesture | null) => token !== null && gesture === token,
    preview(token: OrbitGesture | null, next: OrbitViewport) {
      if (token && gesture === token) update(next);
    },
    end(token: OrbitGesture | null) {
      if (!token || gesture !== token) return;
      gesture = null;
      if (value && !equal(value, token.from)) publish(value, "gesture");
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
    accept(next: OrbitViewport | null) {
      const echo = pending.findIndex((pose) => equal(pose, next));
      if (echo >= 0) {
        pending.splice(0, echo + 1);
        return;
      }
      pending = [];
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

/** Scope changes (system, document, view mode) cancel gestures even if the saved pose is equal.
 * pageValue is the actual Page key, distinct from a derived fit. Its identity detects explicit
 * external moves even to the same saved pose; rebuilding an equal fit is not such a move.
 * Delayed acknowledgements of our commits must not reset a newer gesture. */
export function useLiveOrbit(
  pose: OrbitViewport | null,
  commit: (v: OrbitViewport, how: Move) => void,
  scope: unknown,
  pageValue: unknown = pose,
) {
  const latest = useRef(commit);
  latest.current = commit;
  const [orbit] = useState(() => createLiveOrbit(pose, (v, how) => latest.current(v, how)));
  const previous = useRef({ pose, scope, pageValue });
  useLayoutEffect(() => {
    if (previous.current.scope !== scope) orbit.restore(pose);
    else if (previous.current.pageValue !== pageValue || !equal(previous.current.pose, pose))
      orbit.accept(pose);
    previous.current = { pose, scope, pageValue };
  }, [orbit, pose, scope, pageValue]);
  return orbit;
}
