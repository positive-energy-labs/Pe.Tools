import { PANE_OBSTACLES } from "@pe/kit/lang/floater";
import { PictureContext } from "@pe/kit/lang/pane";
import { Switcher } from "@pe/kit/lang/switcher";
import {
  createContext,
  createElement,
  Fragment,
  memo,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ScopeGestures, actionScopeKeys, type ScopeKey } from "@pe/kit/keys";
import type { PlaneViewport } from "@pe/agent-contracts";
import type { PictureBounds } from "./framing";
import { viewportProject, type Project } from "./projection";
import { useStageKeys } from "./stage-keys";
import { flyTo, glideLook, type LiveOrbit } from "@pe/kit/lang/live-orbit";
import { applyLook, center, frame, shiftOnScreen, type OrbitViewport } from "./orbit";
import type { Bounds } from "./types";
import { useViewHistory } from "./view-history";
import type { Bounds2 } from "#/lib/affine-frame";
import type { usePlaneViewport } from "./use-plane-viewport";

import { STAGE_ACTIONS } from "./stage-teaching";

type HistoryMove = { history: "push" | "replace" };
/** World bounds in client pixels, shared by placement, framing and landing marks. */
export function projectBounds(
  bounds: Bounds,
  project: Project,
  rect: Pick<DOMRect, "left" | "top">,
): DOMRect | null {
  const points = [bounds.minX, bounds.maxX].flatMap((x) =>
    [bounds.minY, bounds.maxY].flatMap((y) =>
      [bounds.minZ, bounds.maxZ].flatMap((z) => {
        const p = project([x, y, z]);
        return p ? [p] : [];
      }),
    ),
  );
  if (!points.length) return null;
  const xs = points.map((p) => p[0] + rect.left),
    ys = points.map((p) => p[1] + rect.top);
  return new DOMRect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
}
/** The only translation from a released camera move to address history. */
export const stageViewport =
  <V extends OrbitViewport | PlaneViewport>(
    publish: (next: { viewport: V }, move: HistoryMove) => void,
  ) =>
  (viewport: V, how: "gesture" | "move") =>
    publish({ viewport }, { history: how === "gesture" ? "replace" : "push" });

type Common = {
  host: HTMLElement | null;
  clearSelection: () => void;
  onHistoryStep?: () => void;
};
type OrbitStage = Common & {
  kind: "orbit";
  orbit: LiveOrbit;
  bounds: PictureBounds | null;
  selectedBounds: Bounds | null;
  /** An orthographic axis retains its return pose and fit-only framing. */
  axis?: { label: string; escape: () => void; frame: () => void } | null;
};
type PlaneStage = Common & {
  kind: "plane";
  viewport: ReturnType<typeof usePlaneViewport>;
  bounds: Bounds2 | null;
  selectedBounds: Bounds2 | null;
};

/** Selection is input to the pivot only. Only these named verbs may move a stage. */
function useStageBindings(options: OrbitStage | PlaneStage) {
  const go = useViewHistory(options.onHistoryStep);
  const readProjection = () =>
    (options.kind === "orbit" ? options.orbit.read()?.projection : null) ?? "perspective";
  const projection = useSyncExternalStore(
    options.kind === "orbit" ? options.orbit.subscribe : () => () => {},
    readProjection,
    readProjection,
  );
  const setProjection = (next: NonNullable<OrbitViewport["projection"]>) => {
    if (options.kind !== "orbit" || options.axis) return;
    const pose = options.orbit.read();
    if (pose && next !== projection) options.orbit.move({ ...pose, projection: next });
  };
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  const poseOf = (target: Bounds | null) => {
    if (options.kind !== "orbit" || !options.bounds) return null;
    const { bounds, host, orbit } = options;
    const rect = host?.getBoundingClientRect();
    const aspect = rect?.height ? rect.width / rect.height : 1;
    const view = target
      ? subjectPose(bounds, target, orbit.read(), aspect)
      : frame(bounds.scene, bounds.subject, orbit.read() ?? undefined, aspect);
    return host ? clearPose(view, target ?? bounds.subject, bounds.scene, host) : view;
  };
  const frameOn = (target: Bounds | null) => {
    if (options.kind === "plane") {
      const box = options.selectedBounds ?? options.bounds;
      const next = box && options.viewport.frame(box, options.selectedBounds ? 48 : 0);
      if (next) options.viewport.move(next, "move");
      return;
    }
    if (options.axis) return options.axis.frame();
    const pose = poseOf(target);
    if (pose) flyTo(options.orbit, pose, { scene: options.bounds?.scene });
  };
  const keys = actionScopeKeys([
    {
      ...STAGE_ACTIONS.frame,
      invoke: () => frameOn(options.kind === "orbit" ? options.selectedBounds : null),
    },
    ...(options.kind === "orbit"
      ? [
          {
            ...STAGE_ACTIONS.projection,
            available: () => !options.axis,
            invoke: () => setProjection(projection === "parallel" ? "perspective" : "parallel"),
          },
          {
            ...STAGE_ACTIONS.look,
            available: () => !options.axis,
            invoke: () => {
              const now = options.orbit.read();
              if (now)
                flyTo(options.orbit, applyLook(now.elev >= 89 ? "iso" : "plan", now), {
                  scene: options.bounds?.scene,
                });
            },
          },
          {
            ...STAGE_ACTIONS.north,
            available: () => !options.axis,
            invoke: () => {
              glideLook(options.orbit);
            },
          },
        ]
      : []),
  ]);
  const escape: ScopeKey = {
    hotkey: "Escape",
    label: options.kind === "orbit" && options.axis ? options.axis.label : "clear the selection",
    callback: () => {
      if (options.kind === "orbit" && options.axis) options.axis.escape();
      else options.clearSelection();
    },
    options: { conflictBehavior: "allow" },
  };
  const gestures = useStageKeys(keys, escape, body, options.kind === "orbit");
  useEffect(() => {
    if (options.kind !== "plane" || !options.host) return;
    const frame = () => frameOn(null);
    options.host.addEventListener("dblclick", frame);
    return () => options.host?.removeEventListener("dblclick", frame);
  }, [options]);
  return {
    projection:
      options.kind === "orbit" && !options.axis
        ? createElement(Switcher<NonNullable<OrbitViewport["projection"]>>, {
            ariaLabel: "projection",
            value: projection,
            onChange: setProjection,
            options: (["perspective", "parallel"] as const).map((value) => ({
              value,
              label: value,
              title: `${value} projection · O switches projection`,
            })),
          })
        : null,
    goTo: createElement(ScopeGestures, { gestures, host: options.host }) as ReactNode,
    frameOn,
    poseOf,
    go,
    orbitPivot:
      options.kind === "orbit" && options.selectedBounds ? center(options.selectedBounds) : null,
  };
}

const StageContext = createContext<ReturnType<typeof useStageBindings> | null>(null);

/** The picture host supplies its state once; every nested part gets the same verbs. */
export const PictureStage = memo(function PictureStage({
  children,
  goTo,
  ...picture
}: (OrbitStage | PlaneStage) & {
  goTo: ReactNode | ((stage: ReturnType<typeof useStageBindings>) => ReactNode);
  children: ReactNode | ((stage: NonNullable<ReturnType<typeof useStage>>) => ReactNode);
}) {
  const bindings = useStageBindings(picture);
  const latest = useRef(picture);
  latest.current = picture;
  const box = useCallback(() => {
    const p = latest.current;
    const rect = p.host?.getBoundingClientRect();
    const b = p.selectedBounds;
    if (!rect || !b || (p.kind === "orbit" && p.axis)) return null;
    if (p.kind === "plane") {
      const { scale, tx, ty } = p.viewport.view;
      return new DOMRect(
        rect.left + b.minX * scale + tx,
        rect.top + b.minY * scale + ty,
        (b.maxX - b.minX) * scale,
        (b.maxY - b.minY) * scale,
      );
    }
    const pose = p.orbit.read();
    return pose && p.bounds
      ? projectBounds(p.selectedBounds!, viewportProject(pose, p.bounds.scene, rect), rect)
      : null;
  }, []);
  const stage = {
    ...bindings,
    goTo: createElement(
      Fragment,
      null,
      bindings.goTo,
      typeof goTo === "function" ? goTo(bindings) : goTo,
    ),
  };
  return createElement(
    PictureContext,
    { value: { selected: picture.selectedBounds != null, box, projection: bindings.projection } },
    createElement(
      StageContext,
      { value: stage },
      typeof children === "function" ? children(stage) : children,
    ),
  );
});

/** The picture owns the bindings; consumers only read its verbs. */
export function useStage() {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useStage requires a PictureStage");
  return stage;
}

/** A framed subject keeps its neighbours in view: never under this many feet across, and the
 * subject itself fills at most about half the frame, so one fitting is never a 400x close-up. */
const CONTEXT_FT = 18;
const CONTEXT_GROW = 2;
const inContext = (b: Bounds): Bounds => {
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
function subjectPose(
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
function clearPose(
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
  const projected = projectBounds(target, viewportProject(view, scene, at), at);
  if (!projected) return view;
  const { width: w, height: h } = projected;
  const [cx, cy] = [projected.x - at.left + w / 2, projected.y - at.top + h / 2];
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
