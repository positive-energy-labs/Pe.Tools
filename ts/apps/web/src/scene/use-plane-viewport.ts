import { PANE_OBSTACLES } from "@pe/kit/lang/floater";
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import type { Bounds2, Viewport2 } from "#/lib/affine-frame";
import { ScopeGestures } from "@pe/kit/keys";
import { captureGestures, createWheelReader, PLANE_GESTURES, wheelPlane } from "./gestures";
import { fitView } from "./plane";

export const PLAN_CLICK_PX = 5;

/** What docked surfaces take: a band at the top and the bottom (the readout, the key legend), and
 * the right edge of a top-left one (the readout), which a fit may clear sideways instead. */
type Inset = { top: number; bottom: number; left: number };

/** What surfaces docked over the field cover, as a top and a bottom band: a fit stays clear of them. */
function measureInset(host: HTMLElement): Inset {
  const h = host.getBoundingClientRect();
  let top = 0,
    bottom = 0,
    left = 0;
  for (const el of (host.closest("[data-slot='pane-field']") ?? host).querySelectorAll(
    PANE_OBSTACLES,
  )) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    if (r.top - h.top < h.height / 2) {
      top = Math.max(top, r.bottom - h.top);
      if (r.left - h.left < h.width / 2) left = Math.max(left, r.right - h.left);
    } else bottom = Math.max(bottom, h.bottom - r.top);
  }
  return { top, bottom, left };
}

/**
 * Page owns the pose. A null pose fits at render; the first gesture starts from that fit. Every fit
 * (the rest pose and `frame`) lands clear of the surfaces docked over the field, so the readout
 * and the legend never cover the plan they describe (SURFACE-PHILOSOPHY L2; `clearPose` in 3D).
 */
export function usePlaneViewport(
  viewport: PlaneViewport | null,
  fit: Bounds2 | null,
  onViewport: (next: PlaneViewport, how: "gesture" | "move") => void,
  readout: ReactNode,
  rest?: (size: Viewport2) => PlaneViewport,
) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Viewport2 | null>(null);
  const [inset, setInset] = useState<Inset>({ top: 0, bottom: 0, left: 0 });
  const clearFit = (box: Bounds2, at: Viewport2, pad = 0): PlaneViewport => {
    const fit = (x: number, y: number, width: number, height: number) => {
      const v = fitView(box, { width: Math.max(1, width), height: Math.max(1, height) }, pad);
      return { ...v, tx: v.tx + x, ty: v.ty + y };
    };
    const below = fit(0, inset.top, at.width, at.height - inset.top - inset.bottom);
    if (!inset.left) return below;
    const beside = fit(inset.left, 0, at.width - inset.left, at.height - inset.bottom);
    return beside.scale > below.scale ? beside : below;
  };
  const view =
    viewport ??
    (size && rest
      ? rest(size)
      : fit && size
        ? clearFit(fit, size)
        : { kind: "plane" as const, scale: 1, tx: 0, ty: 0 });
  const latest = useRef({ view, onViewport });
  latest.current = { view, onViewport };
  const pending = useRef<PlaneViewport | null>(null);
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; view: PlaneViewport } | null>(null);
  const dragDistance = useRef(0);
  const [dragging, setDragging] = useState(false);
  const move = useCallback((next: PlaneViewport, how: "gesture" | "move") => {
    if (how === "move") {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
      latest.current.onViewport(next, how);
      return;
    }
    pending.current = next;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const pose = pending.current;
        pending.current = null;
        if (pose) latest.current.onViewport(pose, "gesture");
      });
  }, []);
  useEffect(() => {
    if (!host) return;
    const inset = () => {
      const next = measureInset(host);
      setInset((was) =>
        was.top === next.top && was.bottom === next.bottom && was.left === next.left ? was : next,
      );
    };
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
      inset();
    });
    observer.observe(host);
    // The docked surfaces resize on their own (a selection fills the readout): re-measure the bands.
    const docks = new ResizeObserver(inset);
    const field = host.closest("[data-slot='pane-field']") ?? host;
    const observeDocks = () => {
      field.querySelectorAll(PANE_OBSTACLES).forEach((el) => docks.observe(el));
      inset();
    };
    observeDocks();
    const children = new MutationObserver(observeDocks);
    children.observe(field, { childList: true, subtree: true });
    const reader = createWheelReader();
    const wheel = (event: WheelEvent) => {
      // A surface over the picture (the readout) claims its own wheel: it scrolls, the picture stays.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const v = pending.current ?? latest.current.view;
      move(
        wheelPlane(v, reader(event), event, event.clientX - rect.left, event.clientY - rect.top),
        "gesture",
      );
    };
    const releaseGestures = captureGestures(host, wheel);
    return () => {
      observer.disconnect();
      docks.disconnect();
      children.disconnect();
      releaseGestures();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
    };
  }, [host, move]);
  return {
    readout: createElement(
      Fragment,
      null,
      createElement(ScopeGestures, { gestures: PLANE_GESTURES, host }),
      readout,
    ),
    setHost,
    host,
    size,
    view,
    move,
    /** The pose that shows `box` (content px) clear of the docked surfaces; null before a size. */
    frame: (box: Bounds2, pad = 0) => (size ? clearFit(box, size, pad) : null),
    dragging,
    dragDistance,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 && event.button !== 1) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          view: pending.current ?? latest.current.view,
        };
        dragDistance.current = 0;
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        dragDistance.current = Math.max(dragDistance.current, Math.abs(dx) + Math.abs(dy));
        if (dragDistance.current < PLAN_CLICK_PX) return;
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        move({ ...start.view, tx: start.view.tx + dx, ty: start.view.ty + dy }, "gesture");
      },
      onPointerUp: () => {
        drag.current = null;
        setDragging(false);
      },
      onPointerCancel: () => {
        drag.current = null;
        setDragging(false);
      },
    },
  };
}
