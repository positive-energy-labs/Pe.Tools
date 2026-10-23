/**
 * The model picture: the subject system's real meshes (`Scene3D`, the capture `useScene` reads)
 * under the DOM annotation layer. `page.viewport` null is the fit of the subject; a gesture commits
 * an explicit pose (replace), a named move (F, P) computes one from the current bounds and pushes
 * it once, and F with nothing selected clears to fit. With no meshes yet the annotations still draw
 * over the fit of the subject's centrelines; the camera then turns by the globe only.
 */
import { emptyListSearch } from "@pe/agent-contracts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useScopeGestures, useScopeKeys } from "@pe/kit/keys";
import type { PageMove } from "#/route/manifest";
import {
  applyLook,
  boundsOfInstances,
  boundsOfPoints,
  center,
  frame,
  shiftOnScreen,
  type OrbitViewport,
} from "#/scene/orbit";
import { viewportProject, type Project, type Size } from "#/scene/projection";
import { ORBIT_GESTURES } from "#/scene/gestures";
import { flyTo, glideLook, isFlying, type LiveOrbit } from "#/scene/live-orbit";
import { Scene3D } from "#/scene/scene3d";
import type { SceneRead } from "#/scene/use-scene";
import type { Bounds, Layer3D, SceneMeshes } from "#/scene/types";

import { Annotations, type Label, type Ruling } from "./annotations";
import type { Encoding } from "./encoding";
import type { DuctsPage } from "./manifest";
import type { Scene } from "./scene";
import type { StageIssue } from "./inbox-rows";
import type { IssueTarget } from "#/scene/types";

/** The bounds the camera is built on (the capture's), and the subject's own inside them. */
export type PictureBounds = { scene: Bounds; subject: Bounds };

/** A framed subject keeps its neighbours in view: never under this many feet across, and the
 * subject itself fills at most about half the frame, so one fitting is never a 400x close-up. */
const CONTEXT_FT = 18;
const CONTEXT_GROW = 2;
const NONE: ReadonlySet<string> = new Set();

const centrelinePoints = (scene: Scene, ids?: ReadonlySet<number>) => [
  ...scene.segments.flatMap((f) => (!ids || ids.has(f.segment.id) ? f.segment.polyline : [])),
  ...scene.nodes.flatMap((f) => (!ids || ids.has(f.node.id) ? [f.node.point] : [])),
];

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

/** Where elements sit: their meshes', else their centrelines'; null when none is drawn. */
export function boundsOfIds(
  meshes: SceneMeshes | null,
  scene: Scene,
  ids: ReadonlySet<number>,
): Bounds | null {
  return (
    (meshes && boundsOfInstances(meshes, (i) => i.revitId !== null && ids.has(i.revitId))) ??
    boundsOfPoints(centrelinePoints(scene, ids))
  );
}

/**
 * The pose that shows `ids` with their neighbours, seen the way the camera already looks (yaw and
 * elevation kept, so a jump never spins the model). A zoom already within reach of the frame is
 * kept: hopping between nearby subjects pans rather than pumping in and out.
 */
export function subjectPose(
  bounds: PictureBounds,
  target: Bounds,
  now: OrbitViewport | null,
): OrbitViewport {
  const to = frame(bounds.scene, inContext(target), now ?? undefined);
  return now && now.zoom > to.zoom / 1.6 && now.zoom < to.zoom * 1.6 ? { ...to, zoom: now.zoom } : to;
}

const overlap = (a: DOMRect, b: DOMRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const ANCHORS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];

/**
 * `view` slid so `target` lands in the most open part of the picture: clear of the readout and
 * every surface docked over it (`pane-dock`, `pane-legend`, `floater`), the centre preferred. A narrow picture
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
    ...field.querySelectorAll(
      "[data-slot='pane-dock'], [data-slot='pane-legend'], :scope > [data-slot='floater']",
    ),
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
  const [cx, cy] = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
  const best = ANCHORS.flatMap((fx) => ANCHORS.map((fy) => [fx * at.width, fy * at.height]))
    .map(([x, y]) => {
      const box = new DOMRect(at.left + x! - w / 2, at.top + y! - h / 2, w, h);
      const covered = blocks.reduce((sum, b) => sum + overlap(box, b), 0);
      const outside = w * h - overlap(box, at);
      return { x: x!, y: y!, cost: (covered + outside) * 1e3 + Math.hypot(x! - at.width / 2, y! - at.height / 2) };
    })
    .reduce((a, b) => (b.cost < a.cost ? b : a));
  return shiftOnScreen(view, scene, at.height, best.x - cx, best.y - cy);
}

/** The capture's bounds and its focus meshes', or the subject's centrelines' with no meshes. */
export function usePictureBounds(meshes: SceneMeshes | null, scene: Scene): PictureBounds | null {
  return useMemo(() => {
    if (meshes)
      return {
        scene: meshes.bounds,
        subject: boundsOfInstances(meshes, (i) => i.focus) ?? meshes.bounds,
      };
    const own = boundsOfPoints(centrelinePoints(scene));
    return own && { scene: own, subject: own };
  }, [meshes, scene]);
}

/** The pose the picture shows: the page's, else the fit of the subject; null with nothing to fit. */
export const poseOf = (
  viewport: DuctsPage["viewport"],
  bounds: PictureBounds | null,
): OrbitViewport | null =>
  viewport?.kind === "orbit" ? viewport : bounds ? frame(bounds.scene, bounds.subject) : null;

export function ModelPicture({
  read,
  bounds,
  orbit,
  wheelHost,
  scene,
  layers,
  encoding,
  selected,
  lit,
  hovered,
  labels,
  rulings,
  findings3d,
  issues,
  hoveredIssue,
  onIssueHover,
  pointOf,
  issue,
  setPage,
  onPick,
  onRuling,
  onHover,
}: {
  read: SceneRead;
  bounds: PictureBounds | null;
  orbit: LiveOrbit;
  wheelHost?: HTMLElement | null;
  scene: Scene;
  layers: ReadonlySet<string>;
  encoding: Encoding;
  /** Element ids: the selection (with its leg), and what a hovered row elsewhere lights. */
  selected: ReadonlySet<number>;
  lit: ReadonlySet<number>;
  hovered: number | null;
  labels: readonly Label[];
  rulings: readonly Ruling[];
  /** The stage's issue marks in 3D (`finding-layers.ts`, `scene/damage.ts`), each already gated by its own picture layer. */
  findings3d: readonly Layer3D[];
  issues: readonly StageIssue[];
  hoveredIssue: string | null;
  onIssueHover: (key: string | null) => void;
  pointOf: (id: number) => readonly number[] | null;
  issue: string;
  setPage: (next: Partial<DuctsPage>, move?: PageMove<DuctsPage>) => void;
  onPick: (id: number, at: { x: number; y: number }) => void;
  onRuling: (r: Ruling, at: { x: number; y: number }) => void;
  onHover: (id: number | null) => void;
}) {
  const meshes = read.meshes;
  const pickIssue = (target: IssueTarget) => {
    setPage(
      { selected: String(target.elementId), issue: target.key, rulingSearch: emptyListSearch() },
      { history: "push" },
    );
  };
  const hoverIssue = (target: IssueTarget | null) => {
    onIssueHover(target?.key ?? null);
    onHover(target?.elementId ?? null);
  };
  // Subscribe inside the picture, never in the route: even the centreline-only preview follows
  // the live camera while native meshes are loading, without waking pricing or the inbox.
  // A flight holds the last pose: the meshes fly (the renderer follows the orbit itself) while the
  // DOM layer fades and re-projects once at the landing, never a React render per frame.
  // Without meshes the layer IS the picture, so it follows every frame.
  const held = useRef<OrbitViewport | null>(null);
  const pose = useSyncExternalStore(orbit.subscribe, () =>
    meshes && held.current && isFlying(orbit) ? held.current : (held.current = orbit.read()),
  );
  const fade = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!meshes) return;
    return orbit.subscribe(() => {
      const flying = isFlying(orbit);
      if (fade.current && (fade.current.dataset.flying === "") !== flying)
        if (flying) fade.current.dataset.flying = "";
        else delete fade.current.dataset.flying;
    });
  }, [orbit, meshes]);
  const [said, setSaid] = useState<string | null>(null);
  // A callback ref: the element can arrive after the first commit (a pane revealed later).
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    if (!host) return;
    const o = new ResizeObserver(([e]) => {
      const { width, height } = e!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    o.observe(host);
    return () => o.disconnect();
  }, [host]);
  // With meshes the renderer reports every frame's camera; without, the fit is computed here.
  const [framed, setFramed] = useState<{ project: Project; size: Size } | null>(null);
  const lastFrame = useRef(framed);
  useEffect(() => {
    if (lastFrame.current !== framed && !isFlying(orbit)) setFramed(lastFrame.current);
  }, [pose]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = meshes
    ? framed
    : pose && bounds && size
      ? { project: viewportProject(pose, bounds.scene, size), size }
      : null;

  const keysOf = useMemo(() => {
    const out = new Map<number, string[]>();
    for (const i of meshes?.instances ?? [])
      if (i.revitId !== null) out.set(i.revitId, [...(out.get(i.revitId) ?? []), i.key]);
    return out;
  }, [meshes]);
  const keys = (ids: ReadonlySet<number>) =>
    ids.size ? new Set([...ids].flatMap((id) => keysOf.get(id) ?? [])) : NONE;
  const selectedKeys = useMemo(() => keys(selected), [selected, keysOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const litKeys = useMemo(() => keys(lit), [lit, keysOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const isolated = layers.has("meshes") ? null : NONE;

  const move = (viewport: OrbitViewport | null) => {
    if (viewport) return flyTo(orbit, viewport, { scene: bounds?.scene });
    // Fit can already be the saved Page value while a live gesture has moved away from it: fly to
    // it, then Page's fit (null) is the one entry, not the fit's coordinates.
    const fit = poseOf(null, bounds);
    if (fit)
      flyTo(orbit, fit, {
        history: null,
        scene: bounds?.scene,
        onLand: () => setPage({ viewport: null }, { history: "push" }),
      });
  };
  // Selection changes only the centre of subsequent orbit drags, never the camera's look target.
  const primary = selected.values().next().value;
  const orbitPivot = useMemo(() => {
    const target =
      meshes && primary !== undefined
        ? boundsOfInstances(meshes, (i) => i.revitId === primary)
        : null;
    return target ? center(target) : null;
  }, [primary, meshes]);

  // Only an explicit frame moves the camera; the first click no longer displaces the second hit.
  const frameAt = (key: string | null) => {
    if (!bounds) return;
    const target = key && meshes ? boundsOfInstances(meshes, (i) => i.key === key) : null;
    if (!target) return move(null);
    const view = subjectPose(bounds, target, orbit.read());
    flyTo(orbit, host ? clearPose(view, target, bounds.scene, host) : view, { scene: bounds.scene });
  };

  useScopeGestures(ORBIT_GESTURES);
  useScopeKeys([
    {
      hotkey: "F",
      label: "frame",
      says: "Frame the selection; with nothing selected, fit the system",
      callback: () => {
        if (!selected.size) return move(null);
        const target = boundsOfIds(meshes, scene, selected);
        if (!bounds || !target) return setSaid("the selection is not in the picture");
        const view = subjectPose(bounds, target, orbit.read());
        move(host ? clearPose(view, target, bounds.scene, host) : view);
      },
    },
    {
      hotkey: "P",
      label: "plan or isometric",
      says: "Look straight down (plan), or back to the isometric; the pivot and zoom stay",
      callback: () =>
        pose
          ? move(
              applyLook((orbit.read() ?? pose).elev >= 89 ? "iso" : "plan", orbit.read() ?? pose),
            )
          : setSaid("no pose yet: the picture has nothing to look at"),
    },
    {
      hotkey: "N",
      label: "look north",
      says: "Glide to look north. Elevation, zoom and pivot stay",
      callback: () => {
        const now = orbit.read();
        if (!now) return setSaid("no pose yet: the picture has nothing to look at");
        glideLook(orbit);
      },
    },
  ]);
  // Escape binds on the document, not the pane element: a pick from the tree or the inputs leaves
  // focus there, and the selection must still clear. Pane keys with focus in a field are not taken
  // (ignoreInputs), and a floater's own Escape (close globe) sits deeper and wins.
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    [
      {
        hotkey: "Escape",
        label: "clear the selection",
        says: "Clear the selection; the next orbit uses the view centre, without moving the camera",
        // Listed always (help is a snapshot, so an `available` gate hid it whenever nothing was
        // picked); it refuses in words while nothing is, and does nothing.
        refusal: selected.size ? null : "nothing is selected",
        callback: () => {
          if (selected.size) setPage({ selected: "" }, { history: "push" });
        },
        options: { conflictBehavior: "allow" },
      },
    ],
    body,
  );

  const status = said
    ? said
    : read.error
      ? `scene: ${read.error}`
      : read.pending
        ? "capturing the system's meshes…"
        : !meshes
          ? "no meshes: choose a system on a Revit document"
          : null;
  return (
    <div ref={setHost} data-model-picture="" className="relative min-h-0 flex-1 overflow-hidden">
      {meshes && pose ? (
        <Scene3D
          className="size-full"
          meshes={meshes}
          orbit={orbit}
          orbitPivot={orbitPivot}
          wheelHost={wheelHost ?? host}
          selected={selectedKeys}
          lit={litKeys}
          isolated={isolated}
          layers={findings3d}
          hoveredIssue={hoveredIssue}
          focusedIssue={issue}
          onIssueHover={hoverIssue}
          onIssuePick={pickIssue}
          onProject={(project, at) => {
            lastFrame.current = { project, size: at };
            if (!isFlying(orbit)) setFramed(lastFrame.current);
          }}
          onDoubleClick={(pick) => frameAt(pick?.instance.key ?? null)}
          onPick={(pick, event) => {
            if (event.detail > 1) return;
            if (!pick) return;
            if (pick.instance.revitId === null) return setSaid("linked element, not selectable");
            setSaid(null);
            onPick(pick.instance.revitId, { x: event.clientX, y: event.clientY });
          }}
        />
      ) : null}
      {overlay ? (
        <div
          ref={fade}
          className="pointer-events-none absolute inset-0 transition-opacity duration-150 data-flying:opacity-0"
        >
        <Annotations
          {...overlay}
          scene={scene}
          layers={layers}
          encoding={encoding}
          selected={selected}
          hovered={hovered}
          labels={labels}
          issues={issues}
          onIssueHover={hoverIssue}
          rulings={rulings}
          pointOf={pointOf}
          issue={issue}
          onPick={onPick}
          onFrame={(id) => frameAt(meshes?.instances.find((i) => i.revitId === id)?.key ?? null)}
          onRuling={onRuling}
          onHover={onHover}
        />
        </div>
      ) : null}
      {status ? (
        <p
          role="status"
          className="t-small text-ink-2 absolute bottom-2 right-2 m-0"
          data-model-status=""
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
