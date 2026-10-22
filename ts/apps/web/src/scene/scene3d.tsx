/**
 * The one 3D renderer in the web app. The route owns the viewport (a Page key of kind `orbit`) and
 * hands it in; the canvas never keeps camera state across renders. Orbit and zoom report as
 * "gesture" (the route replaces history), fit and presets as "move" (the route pushes).
 *
 * The canvas names the Revit element under the pointer in `data-revit-ids`, so the app-root
 * element menu answers right-click and BX here like on any row. Double-click stays free.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@pe/kit/lang/button";
import { revitTarget } from "@pe/kit/lang/row";
import { fit, presets, samePose, type OrbitViewport, type Preset } from "./orbit";
import { isClick, pickAt } from "./picking";
import { createRenderer, type ClipVolume, type SceneRenderer } from "./renderer";
import type { Layer3D, Pick, SceneMeshes } from "./types";

export type Scene3DProps = {
  meshes: SceneMeshes | null;
  /** Decoded by the route from its page key. */
  viewport: OrbitViewport;
  onViewport: (next: OrbitViewport, how: "gesture" | "move") => void;
  selected?: ReadonlySet<string>;
  hidden?: ReadonlySet<string>;
  isolated?: ReadonlySet<string> | null;
  layers?: readonly Layer3D[];
  /** A click (a press that stayed within 5 px); null when it met nothing. */
  onPick?: (pick: Pick | null, event: PointerEvent) => void;
  /** False for a hit the caller has cut away; picking and the element menu look past it. */
  clip?: (hit: Pick) => boolean;
  /** The shader side of the caller's cuts, packed relative to the bounds centre. */
  clipVolume?: ClipVolume | null;
  className?: string;
};

const PRESETS: { key: Preset; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "north", label: "North" },
  { key: "east", label: "East" },
];
/** The element menu's attribute, spelled by the one function that owns it. */
const ATTR = Object.keys(revitTarget([0]))[0]!;

export function Scene3D(props: Scene3DProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const core = useRef<SceneRenderer | null>(null);
  /** The last pose this canvas published; its decoded echo is not re-applied. */
  const published = useRef<OrbitViewport | null>(null);
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
    const { canvas, controls } = r;
    const publish = () => {
      const v = r.viewport();
      if (samePose(v, latest.current.viewport, meshes.bounds)) return;
      published.current = v;
      latest.current.onViewport(v, "gesture");
    };
    let queued = 0;
    const start = () => void (gesturing.current = true);
    const change = () => {
      if (gesturing.current) queued ||= requestAnimationFrame(() => ((queued = 0), publish()));
    };
    const end = () => {
      gesturing.current = false;
      cancelAnimationFrame(queued);
      queued = 0;
      publish();
    };
    controls.addEventListener("start", start);
    controls.addEventListener("change", change);
    controls.addEventListener("end", end);

    // The element under the pointer, named where the element menu looks (absent when none).
    const aim = (at: PointerEvent | MouseEvent) => {
      const id = pickAt(r, at, latest.current.clip)?.instance.revitId;
      if (id == null) canvas.removeAttribute(ATTR);
      else canvas.setAttribute(ATTR, String(id));
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
      canvas.removeAttribute(ATTR);
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
      if (!canvas.hasAttribute(ATTR)) event.preventDefault();
    };
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("pointerdown", pointerDown, true);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("contextmenu", contextMenu);
    return () => {
      cancelAnimationFrame(queued);
      cancelAnimationFrame(hover);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("contextmenu", contextMenu);
      r.dispose();
      core.current = null;
      published.current = null;
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
  useEffect(() => {
    core.current?.paint(props.selected, props.hidden, props.isolated);
  }, [props.selected, props.hidden, props.isolated, meshes]);
  useEffect(() => {
    core.current?.setLayers(props.layers);
  }, [props.layers, meshes]);
  useEffect(() => {
    core.current?.setClip(props.clipVolume);
  }, [props.clipVolume, meshes]);

  const move = (v: OrbitViewport) => {
    core.current?.setViewport(v);
    published.current = v;
    props.onViewport(v, "move");
  };
  return (
    <div ref={host} className={`relative min-h-0 overflow-hidden ${props.className ?? ""}`}>
      {failure ? <p className="t-small text-ink-2 p-2">{failure}</p> : null}
      {meshes && !failure ? (
        <div className="absolute right-1 top-1 flex gap-1" data-surface="page">
          <Button
            kind="quiet"
            label="Fit the whole scene, keeping the direction"
            onClick={() => move(fit(meshes.bounds, props.viewport))}
          >
            Fit
          </Button>
          {PRESETS.map(({ key, label }) => (
            <Button
              key={key}
              kind="quiet"
              label={`${label} view`}
              onClick={() => move(presets[key](meshes.bounds))}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
