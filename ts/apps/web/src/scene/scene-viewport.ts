import type { RefObject } from "react";
import type { useElementAttention } from "#/attention";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { viewportCodec } from "@pe/agent-contracts";
import type { NativeObservation } from "#/revit/observation";
import type { LiveOrbit, OrbitGesture } from "@pe/kit/lang/live-orbit";
import { fitDistance, type OrbitViewport } from "./orbit";
import { isClick, pickAt } from "./picking";
import { samePlane, type PlaneViewport } from "./plane";
import { createRenderer, type SceneRenderer } from "./renderer";
import { SceneMeshes, type Bounds } from "./types";
import type { Scene3DProps } from "./scene3d";
import type { SceneController } from "./scene-controller";
import { sceneTarget } from "./scene-target";

/** The element menu's attributes, spelled by the one function that owns them. */
export const ATTRS = Object.keys(revitTarget([0], [{ elementId: 0 }])) as (keyof ReturnType<
  typeof revitTarget
>)[];

type Recovery = {
  orbit: LiveOrbit;
  bounds: Bounds;
  viewport: OrbitViewport;
  plane: PlaneViewport | null;
};
type Latest = Scene3DProps & {
  observation: NativeObservation;
  onHover: ReturnType<typeof useElementAttention>["onHover"];
};
type ViewportOwner = {
  host: RefObject<HTMLDivElement | null>;
  initialBounds: RefObject<Bounds | null>;
  latest: RefObject<Latest>;
  core: RefObject<SceneRenderer | null>;
  controller: SceneController;
  previousView: RefObject<Recovery | null>;
  publishedPlane: RefObject<PlaneViewport | null>;
  gesturing: RefObject<boolean>;
  setFailed: (failure: { meshes: SceneMeshes; message: string }) => void;
};
/** Long-lived listeners own mutable refs, never a React render closure containing old captures. */
export function mountViewport({
  host,
  initialBounds,
  latest,
  core,
  controller,
  previousView,
  publishedPlane,
  gesturing,
  setFailed,
}: ViewportOwner) {
  if (!initialBounds.current) return;
  const initial = new SceneMeshes(new Float32Array(), initialBounds.current, []);
  let r: SceneRenderer;
  try {
    r = createRenderer(host.current!, initial, latest.current.wheelHost ?? host.current!);
  } catch (error) {
    const meshes = latest.current.meshes;
    if (meshes) setFailed({ meshes, message: `WebGL unavailable: ${String(error)}` });
    return;
  }
  core.current = r;
  const detach = controller.attach(r);
  r.setOnFrame(
    (project, size, ray) =>
      controller.read().display?.focus === (latest.current.focusMeshes ?? latest.current.meshes) &&
      latest.current.onProject?.(project, size, ray, gesturing.current),
  );
  const { canvas, moves } = r;
  const wheelHost = latest.current.wheelHost ?? host.current!;
  const orbit = latest.current.orbit;
  const previous = previousView.current;
  previousView.current = null;
  const incoming = orbit.read();
  if (
    previous?.orbit === orbit &&
    incoming &&
    viewportCodec.encode(incoming) === viewportCodec.encode(previous.viewport)
  ) {
    // Zoom is relative to capture bounds. Preserve world framing when context or subject meshes change.
    const kept = {
      ...incoming,
      zoom: (incoming.zoom * fitDistance(initial.bounds)) / fitDistance(previous.bounds),
    };
    r.recoverViewport(
      kept,
      latest.current.plane &&
        previous.plane &&
        samePlane(latest.current.plane.viewport, previous.plane)
        ? latest.current.plane
        : null,
    );
    orbit.restore(kept);
  }
  const unconstrain = orbit.constrain(r.limitViewport);
  const boundsChanged = ({ settled }: { settled: boolean }) => {
    orbit.notify();
    const pose = orbit.read();
    if (!settled) return;
    const p = r.plane();
    if (p) {
      publishedPlane.current = p;
      latest.current.onPlane?.(p, "gesture");
    } else if (pose) orbit.move(pose, "gesture");
  };
  moves.addEventListener("bounds", boundsChanged);
  let token: OrbitGesture | null = null;
  let applying = false;
  const follow = () => {
    if (controller.read().display?.focus !== (latest.current.focusMeshes ?? latest.current.meshes))
      return;
    if (orbit.owns(token)) return;
    const pose = orbit.read();
    if (!pose) return;
    if (viewportCodec.encode(r.viewport()) === viewportCodec.encode(pose)) return;
    applying = true;
    r.setViewport(pose);
    applying = false;
  };
  const unfollow = orbit.subscribe(follow);
  follow();
  const change = () => {
    if (applying || r.plane()) return;
    if (orbit.owns(token)) orbit.preview(token, r.viewport());
    else follow();
  };
  const publish = () => {
    const p = r.plane();
    if (p) {
      const want = latest.current.plane?.viewport;
      if (want && samePlane(p, want)) return;
      publishedPlane.current = p;
      return latest.current.onPlane?.(p, "gesture");
    }
    orbit.end(token);
    token = null;
  };
  const start = () => {
    gesturing.current = true;
    if (!r.plane() && !orbit.owns(token)) token = orbit.begin(...r.gestureSize());
  };
  let wheelEnd: ReturnType<typeof setTimeout> | undefined;
  // FOOTGUN: publishing during a drag navigates the route and reruns domain projections.
  // LiveOrbit shares motion with the globe; onProject keeps annotations current without Page.
  const end = () => {
    if (wheelEnd !== undefined) return;
    if (!gesturing.current) return;
    gesturing.current = false;
    publish();
    orbit.notify();
    r.reportFrame();
  };
  // Wheel events have no release: OrbitControls ends each tick. Save the burst after quiet,
  // not each tick; drawing still runs immediately on every controls change.
  const wheel = () => {
    clearTimeout(wheelEnd);
    wheelEnd = setTimeout(() => {
      wheelEnd = undefined;
      end();
    }, 150);
  };
  const interruptWheel = () => {
    clearTimeout(wheelEnd);
    wheelEnd = undefined;
  };
  const cancel = () => {
    interruptWheel();
    pointers.clear();
    orbit.cancel(token);
    token = null;
    gesturing.current = false;
  };
  wheelHost.addEventListener("wheel", wheel, { capture: true, passive: true });
  canvas.addEventListener("pointerdown", interruptWheel, true);
  canvas.addEventListener("pointercancel", cancel, true);
  moves.addEventListener("start", start);
  moves.addEventListener("change", change);
  moves.addEventListener("end", end);

  // The element under the pointer, declared where the element menu looks (absent when none).
  const aim = (at: PointerEvent | MouseEvent) => {
    if (
      latest.current.pickingEnabled === false ||
      controller.read().display?.focus !== (latest.current.focusMeshes ?? latest.current.meshes)
    )
      return pointerLeave();
    const issue = r.pickIssue(at);
    latest.current.onIssueHover?.(issue);
    if (issue) canvas.dataset.issue = issue.key;
    else delete canvas.dataset.issue;
    canvas.style.cursor = issue ? "pointer" : "";
    r.reach(issue ? null : at);
    const instance = pickAt(r, at, latest.current.clip)?.instance;
    if (!issue) latest.current.onHover(instance?.revitId ?? null);
    r.hoverElement(issue ? null : (instance?.key ?? null));
    const target = instance ? sceneTarget(latest.current.observation, instance) : null;
    const attributes: Partial<Record<(typeof ATTRS)[number], string>> = target
      ? revitTarget(target.ids, target.refs)
      : {};
    for (const name of ATTRS) {
      const value = attributes[name];
      if (value === undefined) canvas.removeAttribute(name);
      else canvas.setAttribute(name, value);
    }
  };
  let hover = 0;
  let over: PointerEvent | null = null;
  let down: { x: number; y: number; button: number } | null = null;
  const pointers = new Set<number>();
  let multiPointer = false;
  const pointerMove = (event: PointerEvent) => {
    if (event.buttons) return;
    over = event;
    hover ||= requestAnimationFrame(() => ((hover = 0), over && aim(over)));
  };
  const pointerLeave = () => {
    over = null;
    latest.current.onHover(null);
    latest.current.onIssueHover?.(null);
    delete canvas.dataset.issue;
    canvas.style.cursor = "";
    r.reach(null);
    r.hoverElement(null);
    for (const name of ATTRS) canvas.removeAttribute(name);
  };
  const pointerDown = (event: PointerEvent) => {
    if (!pointers.size) multiPointer = false;
    pointers.add(event.pointerId);
    multiPointer ||= pointers.size > 1;
    down = { x: event.clientX, y: event.clientY, button: event.button };
  };
  const pointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    // The same click that picks cannot publish a pose, even around a distant selection pivot.
    if (!pointers.size && !multiPointer && down && isClick(down, event)) orbit.cancel(token);
  };
  // Open facts on click, after the document's outside-press capture. Opening on pointerup lets
  // the trailing click immediately dismiss the new popover as an outside press.
  const click = (event: MouseEvent) => {
    if (
      latest.current.pickingEnabled === false ||
      controller.read().display?.focus !== (latest.current.focusMeshes ?? latest.current.meshes)
    )
      return;
    if (event.button !== 0 || down?.button !== 0 || !isClick(down, event)) return;
    const issue = r.pickIssue(event);
    if (issue && latest.current.onIssuePick) return latest.current.onIssuePick(issue, event);
    latest.current.onPick?.(pickAt(r, event, latest.current.clip), event);
  };
  const doubleClick = (event: MouseEvent) => {
    if (
      latest.current.pickingEnabled === false ||
      controller.read().display?.focus !== (latest.current.focusMeshes ?? latest.current.meshes)
    )
      return;
    latest.current.onDoubleClick?.(pickAt(r, event, latest.current.clip), event);
  };
  // A right-drag was a pan: cancel its menu. A right click passes to the element menu, or is
  // cancelled when nothing Revit can select is under it.
  const contextMenu = (event: MouseEvent) => {
    if (down?.button !== 2 || !isClick(down, event)) return event.preventDefault();
    aim(event);
    if (!ATTRS.some((name) => canvas.hasAttribute(name))) event.preventDefault();
  };
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("pointerdown", pointerDown, true);
  canvas.addEventListener("pointerup", pointerUp, true);
  canvas.addEventListener("click", click);
  canvas.addEventListener("contextmenu", contextMenu);
  canvas.addEventListener("dblclick", doubleClick);
  return () => {
    clearTimeout(wheelEnd);
    wheelHost.removeEventListener("wheel", wheel, true);
    canvas.removeEventListener("pointerdown", interruptWheel, true);
    canvas.removeEventListener("pointercancel", cancel, true);
    cancelAnimationFrame(hover);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerleave", pointerLeave);
    canvas.removeEventListener("pointerdown", pointerDown, true);
    canvas.removeEventListener("pointerup", pointerUp, true);
    canvas.removeEventListener("click", click);
    canvas.removeEventListener("contextmenu", contextMenu);
    canvas.removeEventListener("dblclick", doubleClick);
    unfollow();
    moves.removeEventListener("bounds", boundsChanged);
    if (over) latest.current.onHover(null);
    orbit.cancel(token);
    // Recovery needs six bounds numbers, not a retained copy of a disposed scene's geometry.
    previousView.current = {
      orbit,
      bounds: r.frameBounds(),
      viewport: r.viewport(),
      plane: r.plane(),
    };
    unconstrain();
    moves.removeEventListener("start", start);
    moves.removeEventListener("change", change);
    moves.removeEventListener("end", end);
    detach();
    r.dispose();
    core.current = null;
    publishedPlane.current = null;
    gesturing.current = false;
  };
}
