import { PANE_OBSTACLES } from "@pe/kit/lang/floater";
/**
 * Framing a subject on any 3D stage: the pose that shows it with its neighbours, slid clear of the
 * readout and every surface docked over the picture. Shared by /ducts and /space; only a named
 * move (F, double-click, an alias jump) calls these, never a click.
 */
import { frame, shiftOnScreen, type OrbitViewport } from "./orbit";
import { viewportProject } from "./projection";
import type { Bounds } from "./types";

/** The bounds the camera is built on (the capture's), and the subject's own inside them. */
export type PictureBounds = { scene: Bounds; subject: Bounds };

/** A framed subject keeps its neighbours in view: never under this many feet across, and the
 * subject itself fills at most about half the frame, so one fitting is never a 400x close-up. */
const CONTEXT_FT = 18;
const CONTEXT_GROW = 2;
export const inContext = (b: Bounds): Bounds => {
  const grow = (lo: number, hi: number) =>
    (Math.max(CONTEXT_FT, (hi - lo) * CONTEXT_GROW) - (hi - lo)) / 2;
  const [x, y, z] = [grow(b.minX, b.maxX), grow(b.minY, b.maxY), grow(b.minZ, b.maxZ)];
  return {
    minX: b.minX - x,
    maxX: b.maxX + x,
    minY: b.minY - y,
    maxY: b.maxY + y,
    minZ: b.minZ - z,
    maxZ: b.maxZ + z,
  };
};

/**
 * The pose that shows `ids` with their neighbours, seen the way the camera already looks (yaw and
 * elevation kept, so a jump never spins the model). A zoom already within reach of the frame is
 * kept: hopping between nearby subjects pans rather than pumping in and out.
 */
export function subjectPose(
  bounds: PictureBounds,
  target: Bounds,
  now: OrbitViewport | null,
  aspect = 1,
): OrbitViewport {
  const to = frame(bounds.scene, inContext(target), now ?? undefined, aspect);
  return now && now.zoom > to.zoom / 1.6 && now.zoom < to.zoom * 1.6
    ? { ...to, zoom: now.zoom }
    : to;
}

const overlap = (a: DOMRect, b: DOMRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const ANCHORS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];

/**
 * `view` slid so `target` lands in the most open part of the picture: clear of the readout and
 * every surface docked over it (readout, legend, floater), the centre preferred. A narrow picture
 * stacks its floaters down the middle; a subject framed dead centre would land under one.
 */
export function clearPose(
  view: OrbitViewport,
  target: Bounds,
  scene: Bounds,
  picture: Element,
): OrbitViewport {
  const at = picture.getBoundingClientRect();
  const field = picture.closest("[data-slot='pane-field']");
  if (!field || !at.width || !at.height) return view;
  const blocks = [
    ...field.querySelectorAll(`${PANE_OBSTACLES}, :scope > [data-slot='floater']`),
  ].map((el) => el.getBoundingClientRect());
  if (!blocks.length) return view;
  const project = viewportProject(view, scene, at);
  const points = [target.minX, target.maxX].flatMap((x) =>
    [target.minY, target.maxY].flatMap((y) =>
      [target.minZ, target.maxZ].flatMap((z) => {
        const p = project([x, y, z]);
        return p ? [p] : [];
      }),
    ),
  );
  if (!points.length) return view;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const [cx, cy] = [
    (Math.max(...xs) + Math.min(...xs)) / 2,
    (Math.max(...ys) + Math.min(...ys)) / 2,
  ];
  const best = ANCHORS.flatMap((fx) => ANCHORS.map((fy) => [fx * at.width, fy * at.height]))
    .map(([x, y]) => {
      const box = new DOMRect(at.left + x! - w / 2, at.top + y! - h / 2, w, h);
      const covered = blocks.reduce((sum, b) => sum + overlap(box, b), 0);
      const outside = w * h - overlap(box, at);
      return {
        x: x!,
        y: y!,
        cost: (covered + outside) * 1e3 + Math.hypot(x! - at.width / 2, y! - at.height / 2),
      };
    })
    .reduce((a, b) => (b.cost < a.cost ? b : a));
  return shiftOnScreen(view, scene, at.height, best.x - cx, best.y - cy);
}
