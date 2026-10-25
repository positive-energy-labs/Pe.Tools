import { RevitTarget } from "@pe/kit/lang/revit-target";
/**
 * The one 3D renderer in the web app. The route's viewport (a Page key of kind `orbit`) owns the
 * committed pose. The shared LiveOrbit owns motion from either canvas or globe until release.
 * Exception to publishing every visible change through Page: live camera subscribers update
 * directly. Per-move Page writes rerun route and domain work; the Chadds orbit probe measured 918 ms submission gaps that way. The final pose
 * reports as "gesture" (replace history); named moves push. No second persisted camera exists.
 *
 * The canvas names the Revit element under the pointer in `data-revit-ids`, so the app-root
 * element menu answers right-click and BX here like on any row. Double-click is the caller's (frame).
 * Pointer scheme: `gestures.ts`. Named
 * moves (fit, looks) belong to the caller's pane strip and the orbit minimap, not this canvas.
 * `onProject` hands DOM drawn over the canvas the camera of each frame that moved.
 *
 * `plane` shows one axis orthographically over the same scene (pan and zoom only); `viewport` is
 * then the 3D pose kept under it, which the shown axis's thumbnail draws. `thumbs` names 2D
 * canvases this canvas paints each axis into.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useElementAttention } from "#/attention";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { viewportCodec } from "@pe/agent-contracts";
import { type ElementTarget } from "#/revit/element-target";
import {
  observedElements,
  useNativeObservation,
  type NativeObservation,
} from "#/revit/observation";
import type { LiveOrbit, OrbitGesture } from "@pe/kit/lang/live-orbit";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { LOOK } from "./grounds";
import { isClick, pickAt } from "./picking";
import { samePlane, type PlaneAxis, type PlaneViewport } from "./plane";
import type { Project, Ray, Size } from "./projection";
import { createRenderer, type ClipVolume, type SceneRenderer } from "./renderer";
import type { IssueTarget, Layer3D, PaintOf, Pick, SceneInstance, SceneMeshes } from "./types";

export type Scene3DProps = {
  /** Fixed picture state; null explicitly shares a parent readout in an inset. */
  readout: ReactNode;
  meshes: SceneMeshes | null;
  /** Shared live camera; Page is only its committed snapshot. */
  orbit: LiveOrbit;
  /** Selection's orbit centre, independent of the camera's look target. */
  orbitPivot?: readonly number[] | null;
  /** Stable picture including the DOM annotations above the canvas. */
  wheelHost?: HTMLElement | null;
  /** An axis drawn orthographically instead of the orbit; null or absent = the orbit. */
  plane?: { axis: PlaneAxis; viewport: PlaneViewport } | null;
  onPlane?: (next: PlaneViewport, how: "gesture" | "move") => void;
  /** 2D canvases each axis thumbnail is painted into (at that axis's fit). */
  thumbs?: Partial<Record<PlaneAxis, HTMLCanvasElement | null>>;
  selected?: ReadonlySet<string>;
  /** Tinted, weaker than selected: what a hovered row elsewhere on the page stands for. */
  lit?: ReadonlySet<string>;
  hidden?: ReadonlySet<string>;
  isolated?: ReadonlySet<string> | null;
  /** Subject, stub or context per instance, and its colour key; absent: focus is the subject. */
  paintOf?: PaintOf;
  layers?: readonly Layer3D[];
  hoveredIssue?: string | null;
  focusedIssue?: string | null;
  onIssueHover?: (target: IssueTarget | null) => void;
  onIssuePick?: (target: IssueTarget, event: MouseEvent) => void;
  /** A click (a press that stayed within 5 px); null when it met nothing. */
  onPick?: (pick: Pick | null, event: MouseEvent) => void;
  /** A double-click: the element under it, or null on empty space. The caller frames it. */
  onDoubleClick?: (pick: Pick | null, event: MouseEvent) => void;
  /** False for a hit the caller has cut away; picking and the element menu look past it. */
  clip?: (hit: Pick) => boolean;
  /** The shader side of the caller's cuts, packed relative to the bounds centre. */
  clipVolume?: ClipVolume | null;
  /** After each rendered frame whose camera or size moved: world feet to canvas px. */
  onProject?: (project: Project, size: Size, ray: Ray, moving: boolean) => void;
  className?: string;
  children?: ReactNode;
};

/**
 * What the element menu acts on for one drawn element: the displayed observation's captured member,
 * held to the mesh's own UniqueId. A linked element, or one the displayed read never captured,
 * still declares itself so the menu refuses it in words; with no observation the canvas is inert.
 */
export function sceneTarget(
  observation: NativeObservation,
  instance: SceneInstance,
): ElementTarget | null {
  if (!observation.scope) return null;
  if (instance.revitId === null)
    return {
      scope: observation.scope,
      ids: [],
      refs: [
        {
          elementId: null,
          uniqueId: instance.uniqueId,
          documentKey: instance.documentKey,
          linkInstanceIds: instance.linkInstanceId === null ? [] : [instance.linkInstanceId],
        },
      ],
    };
  const target = observedElements(observation, [instance.revitId]);
  return {
    ...target,
    refs: [...(target.refs ?? []), { elementId: instance.revitId, uniqueId: instance.uniqueId }],
  };
}

/** The element menu's attributes, spelled by the one function that owns them. */
const ATTRS = Object.keys(revitTarget([0], [{ elementId: 0 }])) as (keyof ReturnType<
  typeof revitTarget
>)[];

export function Scene3D(props: Scene3DProps): ReactNode {
  const { hovered, onHover, lit: subjectLit, selected: subjectSelected } = useElementAttention();
  const lit = useMemo(
    () =>
      new Set([
        ...(props.lit ?? []),
        ...(props.meshes?.instances
          .filter(
            (instance) =>
              instance.revitId === hovered ||
              (instance.revitId !== null && subjectLit.has(instance.revitId)),
          )
          .map((instance) => instance.key) ?? []),
      ]),
    [props.lit, props.meshes, hovered, subjectLit],
  );
  const selected = useMemo(
    () =>
      new Set([
        ...(props.selected ?? []),
        ...(props.meshes?.instances
          .filter((i) => i.revitId !== null && subjectSelected.has(i.revitId))
          .map((i) => i.key) ?? []),
      ]),
    [props.selected, props.meshes, subjectSelected],
  );
  const host = useRef<HTMLDivElement>(null);
  const observation = useNativeObservation();
  const latest = useRef({ ...props, observation, onHover });
  latest.current = { ...props, observation, onHover };
  const core = useRef<SceneRenderer | null>(null);
  const publishedPlane = useRef<PlaneViewport | null>(null);
  const gesturing = useRef(false);
  const [failed, setFailed] = useState<{ meshes: SceneMeshes; message: string } | null>(null);
  const meshes = props.meshes;
  const failure = failed?.meshes === meshes ? failed.message : null;

  useEffect(() => {
    if (!meshes) return;
    let r: SceneRenderer;
    try {
      r = createRenderer(host.current!, meshes, props.wheelHost ?? host.current!, props.paintOf);
    } catch (error) {
      setFailed({ meshes, message: `WebGL unavailable: ${String(error)}` });
      return;
    }
    core.current = r;
    r.setOnFrame((project, size, ray) =>
      latest.current.onProject?.(project, size, ray, gesturing.current),
    );
    const { canvas, moves } = r;
    const wheelHost = props.wheelHost ?? host.current!;
    const orbit = props.orbit;
    let token: OrbitGesture | null = null;
    let applying = false;
    const follow = () => {
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
      if (event.button !== 0 || down?.button !== 0 || !isClick(down, event)) return;
      const issue = r.pickIssue(event);
      if (issue && latest.current.onIssuePick) return latest.current.onIssuePick(issue, event);
      latest.current.onPick?.(pickAt(r, event, latest.current.clip), event);
    };
    const doubleClick = (event: MouseEvent) =>
      latest.current.onDoubleClick?.(pickAt(r, event, latest.current.clip), event);
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
      if (over) latest.current.onHover(null);
      orbit.cancel(token);
      moves.removeEventListener("start", start);
      moves.removeEventListener("change", change);
      moves.removeEventListener("end", end);
      r.dispose();
      core.current = null;
      publishedPlane.current = null;
      gesturing.current = false;
    };
  }, [meshes, props.orbit, props.wheelHost]);

  useEffect(() => {
    core.current?.setOrbitPivot(props.orbitPivot ?? null);
  }, [props.orbitPivot, meshes, props.wheelHost]);

  // The plane follows the same rule; a fit (null viewport) is the route's to compute.
  useEffect(() => {
    const r = core.current;
    if (!r || gesturing.current) return;
    const next = props.plane ?? null;
    const own = publishedPlane.current;
    if (next && own && samePlane(own, next.viewport)) return;
    publishedPlane.current = null;
    r.setPlane(next);
  }, [props.plane, meshes]);
  useEffect(() => {
    core.current?.setThumbs(props.thumbs ?? {});
  }, [props.thumbs, meshes]);
  useEffect(() => {
    core.current?.paint(selected, props.hidden, props.isolated, lit);
  }, [selected, props.hidden, props.isolated, lit, meshes]);
  useEffect(() => {
    core.current?.setLayers(props.layers);
  }, [props.layers, meshes]);
  useEffect(() => {
    core.current?.lightIssue(props.hoveredIssue ?? null, props.focusedIssue ?? null);
  }, [props.hoveredIssue, props.focusedIssue, meshes]);
  useEffect(() => {
    core.current?.setClip(props.clipVolume);
  }, [props.clipVolume, meshes]);
  useEffect(() => {
    core.current?.setPaint(props.paintOf);
  }, [props.paintOf, meshes]);
  // Dev knobs re-apply live; in production `LOOK.read()` is the code defaults and never changes.
  const look = useSyncExternalStore(knobsChanged, LOOK.read, LOOK.read);
  useEffect(() => {
    core.current?.setLook(look);
  }, [look, meshes]);

  return (
    <RevitTarget scope={observation.scope}>
      <div ref={host} className={`relative min-h-0 overflow-hidden ${props.className ?? ""}`}>
        {failure ? <p className="t-small text-ink-2 p-2">{failure}</p> : null}
        {props.children}
        {props.readout}
      </div>
    </RevitTarget>
  );
}
