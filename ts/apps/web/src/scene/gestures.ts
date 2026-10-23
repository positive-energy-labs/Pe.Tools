/**
 * The one pointer scheme for every spatial picture (3D orbit, axis planes, the schematic), the
 * same on a mouse and a trackpad. Pure: the renderer and the DOM pictures ask it what an event
 * means, so the scheme lives here and nowhere else.
 *
 *   mouse     left-drag orbits; right- or middle-drag pans; Shift+left-drag pans; wheel zooms to the cursor.
 *   trackpad  one-finger drag orbits (it is a left drag); Shift+drag pans; pinch zooms (the browser
 *             sends it as a wheel with ctrlKey); two-finger scroll PANS.
 *   either    double-click frames what is under the cursor, or everything on empty space; a press
 *             that moves past a few px is a drag and never selects.
 *
 * Why two-finger scroll pans rather than orbits: it is the gesture people already read as "move the
 * page" (maps, Figma, Miro, Sketchfab on a Mac), and orbit already has the finger drag. Orbiting
 * with scroll would leave a trackpad with no way to pan without a modifier, and pan is the move
 * CAD users make most. The 2D pictures use the same scroll = pan, pinch = zoom.
 * Revit itself is Shift+middle-drag to orbit; here middle-drag pans and left-drag orbits, matching
 * Autodesk Viewer, Fusion 360 (orbit on the primary drag, pan on a modifier) and every web viewer.
 */
import type { PointerKind, ScopeGesture } from "@pe/kit/keys";
import type { PlaneViewport } from "./plane";
import { clampZoom, zoomPlane } from "./plane";

export type PointerIntent = "orbit" | "pan";

/** What a pressed button (with held modifiers) does in a 3D picture. Mirrors OrbitControls' mapping. */
export function pointerIntent(e: {
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): PointerIntent {
  if (e.button === 1 || e.button === 2) return "pan";
  return e.shiftKey || e.ctrlKey || e.metaKey ? "pan" : "orbit";
}

export type WheelIntent = "pinch" | "scroll" | "wheel";
export type WheelLike = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  timeStamp?: number;
};

/** A notch of a mouse wheel is ~100 px (120 on some); trackpad scroll arrives in smaller steps. */
const NOTCH_PX = 40;
/** A burst keeps its first reading this long: a trackpad flick's momentum tail can exceed a notch. */
const BURST_MS = 160;

/**
 * Reads wheel events as pinch (ctrlKey: how browsers deliver a trackpad pinch), two-finger scroll
 * (pixel deltas that are fractional, on both axes, or smaller than a notch), or a mouse wheel.
 * Stateful only to keep one gesture's momentum tail with its first reading.
 */
export function createWheelReader() {
  let last: { intent: WheelIntent; at: number } | null = null;
  return (e: WheelLike): WheelIntent => {
    const at = e.timeStamp ?? 0;
    if (e.ctrlKey) return (last = { intent: "pinch", at }).intent;
    const burst = last && last.intent !== "pinch" && at - last.at < BURST_MS ? last.intent : null;
    const alone =
      e.deltaMode !== 0
        ? "wheel"
        : (e.deltaX !== 0 && e.deltaY !== 0) ||
            !Number.isInteger(e.deltaX) ||
            !Number.isInteger(e.deltaY) ||
            Math.abs(e.deltaY) < NOTCH_PX
          ? "scroll"
          : "wheel";
    last = { intent: burst ?? alone, at };
    return last.intent;
  };
}

/** Wheel deltas in pixels, whatever the browser's unit. */
export const wheelPixels = (e: Pick<WheelLike, "deltaX" | "deltaY" | "deltaMode">) => {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
  return { x: e.deltaX * k, y: e.deltaY * k };
};

const WHEEL_ZOOM = 0.0015;
const PINCH_ZOOM = 0.01;

/**
 * One wheel event on a 2D plane viewport: a pinch or wheel zooms about the cursor (canvas px x, y),
 * a two-finger scroll pans with the fingers (content follows them).
 */
export function wheelPlane(
  v: PlaneViewport,
  intent: WheelIntent,
  e: Pick<WheelLike, "deltaX" | "deltaY" | "deltaMode">,
  x: number,
  y: number,
): PlaneViewport {
  const d = wheelPixels(e);
  if (intent === "scroll") return { ...v, tx: v.tx - d.x, ty: v.ty - d.y };
  const k = clampZoom(v.scale * Math.exp(-d.y * (intent === "pinch" ? PINCH_ZOOM : WHEEL_ZOOM))) / v.scale;
  return zoomPlane(v, k, x, y);
}

const FRAME = { pointer: "double-click", label: "frame, or fit all" } as const;
const SELECT = { pointer: "click", label: "select" } as const;

/** The 3D picture's gestures: the declaration help draws, the legend lists, and the scheme above implements. */
export const ORBIT_GESTURES: readonly ScopeGesture[] = [
  { pointer: "drag", label: "orbit" },
  { pointer: "drag", keys: ["Shift"], label: "pan the pivot" },
  { pointer: "right-drag", label: "pan the pivot" },
  { pointer: "wheel", label: "zoom to cursor" },
  { pointer: "pinch", label: "zoom (trackpad)" },
  { pointer: "scroll", label: "pan (trackpad)" },
  FRAME,
  SELECT,
];

/** The 2D pictures' gestures: the same scheme without orbit. */
export const PLANE_GESTURES: readonly ScopeGesture[] = [
  { pointer: "drag", label: "pan" },
  { pointer: "wheel", label: "zoom to cursor" },
  { pointer: "pinch", label: "zoom (trackpad)" },
  { pointer: "scroll", label: "pan (trackpad)" },
  { pointer: "double-click", label: "fit the picture" },
  SELECT,
];

export type { PointerKind };
