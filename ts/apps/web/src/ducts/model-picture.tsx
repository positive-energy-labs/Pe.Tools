/**
 * The model picture: the subject system's real meshes (`Scene3D`, the capture `useScene` reads)
 * under the DOM annotation layer. `page.viewport` null is the fit of the subject; a gesture commits
 * an explicit pose (replace), a named move (F, P) computes one from the current bounds and pushes
 * it once, and F with nothing selected clears to fit. With no meshes yet the annotations still draw
 * over the fit of the subject's centrelines; the camera then turns by the globe only.
 */
import { emptyListSearch } from "@pe/agent-contracts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useScopeGestures, useScopeKeys } from "@pe/kit/keys";
import type { PageMove } from "#/route/manifest";
import {
  applyLook,
  boundsOfInstances,
  boundsOfPoints,
  center,
  frame,
  type OrbitViewport,
} from "#/scene/orbit";
import { viewportProject, type Project, type Size } from "#/scene/projection";
import { ORBIT_GESTURES } from "#/scene/gestures";
import { glideLook, glideTo, type LiveOrbit } from "#/scene/live-orbit";
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

/** A framed selection is never smaller than this many feet across, so one fitting is not 400x. */
const FRAME_MIN_FT = 12;
const NONE: ReadonlySet<string> = new Set();

const centrelinePoints = (scene: Scene, ids?: ReadonlySet<number>) => [
  ...scene.segments.flatMap((f) => (!ids || ids.has(f.segment.id) ? f.segment.polyline : [])),
  ...scene.nodes.flatMap((f) => (!ids || ids.has(f.node.id) ? [f.node.point] : [])),
];

const padded = (b: Bounds): Bounds => {
  const grow = (lo: number, hi: number) => Math.max(0, FRAME_MIN_FT - (hi - lo)) / 2;
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
  noRuns,
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
  /** The annotated findings drawn in 3D (`finding-layers.ts`), under the same `findings` layer as the pins. */
  findings3d: readonly Layer3D[];
  issues: readonly StageIssue[];
  hoveredIssue: string | null;
  onIssueHover: (key: string | null) => void;
  noRuns?: Parameters<typeof Annotations>[0]["noRuns"];
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
  const pose = useSyncExternalStore(orbit.subscribe, orbit.read);
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
    if (viewport) return orbit.move(viewport);
    // Fit can already be the saved Page value while a live gesture has moved away from it.
    orbit.restore(poseOf(null, bounds));
    setPage({ viewport: null }, { history: "push" });
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
    glideTo(
      orbit,
      frame(bounds.scene, target ? padded(target) : bounds.subject, orbit.read() ?? undefined),
    );
  };

  useScopeGestures(ORBIT_GESTURES);
  useScopeKeys([
    {
      hotkey: "F",
      label: "frame",
      says: "Frame the selection; with nothing selected, fit the system",
      callback: () => {
        if (!selected.size) return move(null);
        const target = meshes
          ? boundsOfInstances(meshes, (i) => selectedKeys.has(i.key))
          : boundsOfPoints(centrelinePoints(scene, selected));
        if (!bounds || !target) return setSaid("the selection is not in the picture");
        move(frame(bounds.scene, padded(target), orbit.read() ?? undefined));
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
          layers={layers.has("findings") ? findings3d : undefined}
          hoveredIssue={hoveredIssue}
          focusedIssue={issue}
          onIssueHover={hoverIssue}
          onIssuePick={pickIssue}
          onProject={(project, at) => setFramed({ project, size: at })}
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
        <Annotations
          {...overlay}
          scene={scene}
          layers={layers}
          encoding={encoding}
          selected={selected}
          hovered={hovered}
          labels={labels}
          noRuns={noRuns}
          issues={issues}
          hoveredIssue={hoveredIssue}
          onIssueHover={hoverIssue}
          onIssuePick={pickIssue}
          rulings={rulings}
          pointOf={pointOf}
          issue={issue}
          onPick={onPick}
          onFrame={(id) => frameAt(meshes?.instances.find((i) => i.revitId === id)?.key ?? null)}
          onRuling={onRuling}
          onHover={onHover}
        />
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
