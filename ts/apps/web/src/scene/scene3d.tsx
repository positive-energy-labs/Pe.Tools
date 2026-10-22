/**
 * The one 3D renderer in the web app. The route owns the viewport (a Page key of kind `orbit`) and
 * hands it in; the canvas never keeps camera state across renders. Orbit and zoom report as
 * "gesture" (the route replaces history); the caller's named moves push.
 *
 * The canvas names the Revit element under the pointer in `data-revit-ids`, so the app-root
 * element menu answers right-click and BX here like on any row. Double-click stays free. Named
 * moves (fit, looks) belong to the caller's pane strip and the orbit minimap, not this canvas.
 * `onProject` hands DOM drawn over the canvas the camera of each frame that moved.
 *
 * `plane` shows one axis orthographically over the same scene (pan and zoom only); `viewport` is
 * then the 3D pose kept under it, which the shown axis's thumbnail draws. `thumbs` names 2D
 * canvases this canvas paints each axis into.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { revitTarget } from "@pe/kit/lang/row";
import { revitScope, type ElementTarget } from "#/revit/element-target";
import {
  observedElements,
  useNativeObservation,
  type NativeObservation,
} from "#/revit/observation";
import { samePose, type OrbitViewport } from "./orbit";
import { isClick, pickAt } from "./picking";
import { samePlane, type PlaneAxis, type PlaneViewport } from "./plane";
import type { Project, Ray, Size } from "./projection";
import { createRenderer, type ClipVolume, type SceneRenderer } from "./renderer";
import type { Layer3D, Pick, SceneInstance, SceneMeshes } from "./types";

export type Scene3DProps = {
  meshes: SceneMeshes | null;
  /** Decoded by the route from its page key. */
  viewport: OrbitViewport;
  onViewport: (next: OrbitViewport, how: "gesture" | "move") => void;
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
  layers?: readonly Layer3D[];
  /** A click (a press that stayed within 5 px); null when it met nothing. */
  onPick?: (pick: Pick | null, event: PointerEvent) => void;
  /** False for a hit the caller has cut away; picking and the element menu look past it. */
  clip?: (hit: Pick) => boolean;
  /** The shader side of the caller's cuts, packed relative to the bounds centre. */
  clipVolume?: ClipVolume | null;
  /** After each rendered frame whose camera or size moved: world feet to canvas px. */
  onProject?: (project: Project, size: Size, ray: Ray) => void;
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
  const host = useRef<HTMLDivElement>(null);
  const observation = useNativeObservation();
  const latest = useRef({ ...props, observation });
  latest.current = { ...props, observation };
  const core = useRef<SceneRenderer | null>(null);
  /** The last pose this canvas published; its decoded echo is not re-applied. */
  const published = useRef<OrbitViewport | null>(null);
  const publishedPlane = useRef<PlaneViewport | null>(null);
  const gesturing = useRef(false);
  const [failed, setFailed] = useState<{ meshes: SceneMeshes; message: string } | null>(null);
  const meshes = props.meshes;
  const failure = failed?.meshes === meshes ? failed.message : null;

  useEffect(() => {
    if (!meshes) return;
    let r: SceneRenderer;
    try {
      r = createRenderer(host.current!, meshes);
    } catch (error) {
      setFailed({ meshes, message: `WebGL unavailable: ${String(error)}` });
      return;
    }
    core.current = r;
    r.setOnFrame((project, size, ray) => latest.current.onProject?.(project, size, ray));
    const { canvas, moves } = r;
    const publish = () => {
      const p = r.plane();
      if (p) {
        const want = latest.current.plane?.viewport;
        if (want && samePlane(p, want)) return;
        publishedPlane.current = p;
        return latest.current.onPlane?.(p, "gesture");
      }
      const v = r.viewport();
      if (samePose(v, latest.current.viewport, meshes.bounds)) return;
      published.current = v;
      latest.current.onViewport(v, "gesture");
    };
    const start = () => void (gesturing.current = true);
    // FOOTGUN: publishing during a drag navigates the route and reruns domain projections.
    // The renderer owns motion; onProject keeps annotations current without changing Page.
    const end = () => {
      gesturing.current = false;
      publish();
    };
    moves.addEventListener("start", start);
    moves.addEventListener("end", end);

    // The element under the pointer, declared where the element menu looks (absent when none).
    const aim = (at: PointerEvent | MouseEvent) => {
      const instance = pickAt(r, at, latest.current.clip)?.instance;
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
    const pointerMove = (event: PointerEvent) => {
      if (event.buttons) return;
      over = event;
      hover ||= requestAnimationFrame(() => ((hover = 0), over && aim(over)));
    };
    const pointerLeave = () => {
      over = null;
      for (const name of ATTRS) canvas.removeAttribute(name);
    };
    const pointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY, button: event.button };
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || down?.button !== 0 || !isClick(down, event)) return;
      latest.current.onPick?.(pickAt(r, event, latest.current.clip), event);
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
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("contextmenu", contextMenu);
    return () => {
      cancelAnimationFrame(hover);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("contextmenu", contextMenu);
      r.dispose();
      core.current = null;
      published.current = null;
      publishedPlane.current = null;
      gesturing.current = false;
    };
  }, [meshes]);

  // The route's viewport wins, except mid-gesture and for the echo of our own publish.
  useEffect(() => {
    const r = core.current;
    if (!r || !meshes || gesturing.current) return;
    const own = published.current;
    if (own && samePose(own, props.viewport, meshes.bounds)) return;
    published.current = null;
    r.setViewport(props.viewport);
  }, [props.viewport, meshes]);
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
    core.current?.paint(props.selected, props.hidden, props.isolated, props.lit);
  }, [props.selected, props.hidden, props.isolated, props.lit, meshes]);
  useEffect(() => {
    core.current?.setLayers(props.layers);
  }, [props.layers, meshes]);
  useEffect(() => {
    core.current?.setClip(props.clipVolume);
  }, [props.clipVolume, meshes]);

  return (
    <div
      ref={host}
      className={`relative min-h-0 overflow-hidden ${props.className ?? ""}`}
      {...revitScope(observation.scope)}
    >
      {failure ? <p className="t-small text-ink-2 p-2">{failure}</p> : null}
      {props.children}
    </div>
  );
}
