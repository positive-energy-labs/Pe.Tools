import { useWork } from "@pe/kit/lang/pane";
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useElementAttention } from "#/attention";
import { useNativeObservation } from "#/revit/observation";
import type { LiveOrbit } from "@pe/kit/lang/live-orbit";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { LOOK } from "./grounds";
import { presetLook, type ScenePreset } from "./presets";
import { type OrbitViewport } from "./orbit";
import { samePlane, type PlaneAxis, type PlaneViewport } from "./plane";
import type { Project, Ray, Size } from "./projection";
import { type ClipVolume, type ContextMode, type SceneRenderer } from "./renderer";
import type { SceneMeshes } from "./types";
import { mountViewport, ATTRS } from "./scene-viewport";
import { SceneController } from "./scene-controller";
import { scenePlan } from "./scene-plan";
import type { Bounds, IssueTarget, Layer3D, PaintOf, Pick } from "./types";

export type Scene3DProps = {
  /** Fixed picture state; null explicitly shares a parent readout in an inset. */
  readout: ReactNode;
  meshes: SceneMeshes | null;
  /** Same immutable focus owner across optional context captures; stages first on scope changes. */
  focusMeshes?: SceneMeshes | null;
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
  /** All captured context by default; halo hides it beyond the subject-distance falloff. */
  contextMode?: ContextMode;
  preset?: ScenePreset;
  layers?: readonly Layer3D[];
  hoveredIssue?: string | null;
  focusedIssue?: string | null;
  onIssueHover?: (target: IssueTarget | null) => void;
  onIssuePick?: (target: IssueTarget, event: MouseEvent) => void;
  /** A retained picture can still move while a replacement read withholds element actions. */
  pickingEnabled?: boolean;
  contextRadiusFt?: number;
  /** A click (a press that stayed within 5 px); null when it met nothing. */
  onPick?: (pick: Pick | null, event: MouseEvent) => void;
  /** A double-click: the element under it, or null on empty space. The caller frames it. */
  onDoubleClick?: (pick: Pick | null, event: MouseEvent) => void;
  /** False for a hit the caller has cut away; picking and the element menu look past it. */
  clip?: (hit: Pick) => boolean;
  /** Shared drawing/picking clip: polygons relative to bounds centre, section in world feet. */
  clipVolume?: ClipVolume | null;
  /** After each rendered frame whose camera or size moved: world feet to canvas px. */
  onProject?: (project: Project, size: Size, ray: Ray, moving: boolean) => void;
  className?: string;
  children?: ReactNode;
};

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
  const [controller] = useState(
    () =>
      new SceneController((focusChanged) => {
        const r = core.current;
        if (!r) return;
        if (focusChanged && !gesturing.current) {
          const pose = latest.current.orbit.read();
          if (pose) r.setViewport(pose);
          else latest.current.orbit.restore(r.viewport());
        }
        r.setClip(latest.current.clipVolume, latest.current.meshes?.bounds);
      }),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.read, controller.read);
  const commitVersion = snapshot.display;
  const previousView = useRef<{
    orbit: LiveOrbit;
    bounds: Bounds;
    viewport: OrbitViewport;
    plane: PlaneViewport | null;
  } | null>(null);
  const publishedPlane = useRef<PlaneViewport | null>(null);
  const gesturing = useRef(false);
  const [failed, setFailed] = useState<{ meshes: SceneMeshes; message: string } | null>(null);
  const meshes = props.meshes;
  const initialBounds = useRef<Bounds | null>(null);
  initialBounds.current ??= meshes?.bounds ?? null;
  const hasBounds = !!initialBounds.current;
  const currentFocus = props.focusMeshes ?? meshes;
  const focusCurrent = snapshot.display?.focus === currentFocus;
  const failure =
    snapshot.state === "failed"
      ? snapshot.error
      : failed?.meshes === meshes
        ? failed.message
        : null;
  const pending =
    snapshot.state === "preparing" ||
    (!!meshes && snapshot.display?.plan.meshes !== meshes && !failure);
  useWork(pending, focusCurrent ? "Preparing nearby context..." : "Preparing model...");

  useEffect(
    () =>
      mountViewport({
        host,
        initialBounds,
        latest,
        core,
        controller,
        previousView,
        publishedPlane,
        gesturing,
        setFailed,
      }),
    [hasBounds, props.orbit, props.wheelHost],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (meshes) core.current?.setFrameBounds(meshes.bounds);
  }, [meshes]);

  // React describes the requested view. The controller alone executes its replacement.
  const look = useSyncExternalStore(knobsChanged, LOOK.read, LOOK.read);
  const shownLook = useMemo(() => presetLook(look, props.preset ?? "all"), [look, props.preset]);
  const request = useMemo(
    () =>
      meshes && currentFocus
        ? {
            focus: scenePlan(currentFocus, props.paintOf, shownLook),
            context: scenePlan(meshes, props.paintOf, shownLook),
            appearance: props.paintOf,
          }
        : null,
    [meshes, currentFocus, props.paintOf, shownLook],
  );
  useEffect(
    () => controller.request(request),
    [controller, request, hasBounds, props.orbit, props.wheelHost],
  );

  useEffect(() => {
    (focusCurrent ? core.current : null)?.setOrbitPivot(props.orbitPivot ?? null);
  }, [props.orbitPivot, meshes, commitVersion, props.wheelHost]);

  // The plane follows the same rule; a fit (null viewport) is the route's to compute.
  useEffect(() => {
    const r = focusCurrent ? core.current : null;
    if (!r || gesturing.current) return;
    const next = props.plane ?? null;
    const own = publishedPlane.current;
    if (next && own && samePlane(own, next.viewport)) return;
    publishedPlane.current = null;
    r.setPlane(next);
  }, [props.plane, meshes, commitVersion]);
  useEffect(() => {
    (focusCurrent ? core.current : null)?.setThumbs(props.thumbs ?? {});
  }, [props.thumbs, meshes, commitVersion]);
  useEffect(() => {
    (focusCurrent ? core.current : null)?.paint(selected, props.hidden, props.isolated, lit);
  }, [selected, props.hidden, props.isolated, lit, meshes, commitVersion]);
  useEffect(() => {
    (focusCurrent ? core.current : null)?.setLayers(props.layers);
  }, [props.layers, meshes, commitVersion]);
  useEffect(() => {
    (focusCurrent ? core.current : null)?.lightIssue(
      props.hoveredIssue ?? null,
      props.focusedIssue ?? null,
    );
  }, [props.hoveredIssue, props.focusedIssue, meshes, commitVersion]);
  useEffect(() => {
    (focusCurrent ? core.current : null)?.setClip(props.clipVolume, meshes?.bounds);
  }, [props.clipVolume, meshes, commitVersion]);
  useEffect(() => {
    if (props.contextRadiusFt === undefined)
      (focusCurrent ? core.current : null)?.setContextMode(props.contextMode);
    else
      (focusCurrent ? core.current : null)?.setContextMode(
        props.contextMode,
        props.contextRadiusFt,
      );
  }, [props.contextMode, props.contextRadiusFt, meshes, commitVersion]);
  // Dev knobs re-apply live; in production `LOOK.read()` is the code defaults and never changes.
  useEffect(() => {
    (focusCurrent ? core.current : null)?.setLook(shownLook);
  }, [shownLook, meshes, commitVersion]);

  useEffect(() => {
    if (props.pickingEnabled !== false) return;
    const canvas = (focusCurrent ? core.current : null)?.canvas;
    if (canvas) for (const name of ATTRS) canvas.removeAttribute(name);
    (focusCurrent ? core.current : null)?.reach(null);
    (focusCurrent ? core.current : null)?.hoverElement(null);
    onHover(null);
    props.onIssueHover?.(null);
  }, [props.pickingEnabled, meshes, commitVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RevitTarget scope={props.pickingEnabled === false || !focusCurrent ? null : observation.scope}>
      <div
        ref={host}
        aria-busy={pending || undefined}
        data-scene-pending={pending ? "" : undefined}
        className={`relative min-h-0 overflow-hidden ${props.className ?? ""}`}
      >
        {failure ? <p className="t-small text-ink-2 p-2">{failure}</p> : null}
        {props.children}
        {props.readout}
      </div>
    </RevitTarget>
  );
}
