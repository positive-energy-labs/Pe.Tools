import { GoToPopup } from "@pe/kit/lang/go-to";
/** Space's model, axis cuts and thumbnails; an axis remembers the 3D pose it left. */
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SubjectTextContext } from "@pe/kit/lang/reach";

import { type Chord } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import type { FloaterSpec } from "@pe/kit/lang/floater";
import { OrbitMinimap } from "@pe/kit/lang/minimap";
import { Pane, PaneOverlay } from "@pe/kit/lang/pane";
import type { PageMove } from "#/route/manifest";
import { PictureStage, stageViewport } from "#/scene/stage-controller";
import { boundsOfInstances, center, frame, type OrbitViewport } from "#/scene/orbit";
import {
  AXIS_LABEL,
  PLANE_AXES,
  fitPlane,
  type PlaneAxis,
  type PlaneViewport,
} from "#/scene/plane";
import type { Psc1Metadata } from "#/scene/psc1";
import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
import { Scene3D } from "#/scene/scene3d";
import type { Layer3D, Pick, SceneMeshes } from "#/scene/types";

import { CutOverlay, type Framed } from "./cuts";
import { LAYER_SAYS, SPACE_LAYERS, rowUnder, type SpaceLayer } from "./layers";
import { pickName } from "./facts";
import type { SpacePage } from "./manifest";
import { cutPolygons, packPolygons, retained, type Cuts, type Polygons } from "./state";
import { useRouteLease } from "#/route/view-bridge";
import { spaceElementKey, toggleLayer } from "@pe/agent-contracts";

type SetPage = (next: Partial<SpacePage>, move?: PageMove<SpacePage>) => void;
const MODE_LABEL = { "3d": "3D", top: "Top", north: "North", east: "East" } as const;
const THUMB = { width: 176, height: 112 } as const;
const push = { history: "push" } as const;
/** The pane's own size, measured; null until it has one. */
function useSize(host: HTMLElement | null) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!host) return;
    const o = new ResizeObserver(([e]) => {
      const { width, height } = e!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    o.observe(host);
    return () => o.disconnect();
  }, [host]);
  return size;
}

export function SpacePicture({
  lease,
  meshes,
  metadata,
  page,
  setPage,
  layers,
  status,
  onError,
  readout,
  legend,
  alias,
}: {
  lease?: { thread: string; ready: boolean; context: Record<string, unknown> };
  meshes: SceneMeshes | null;
  metadata: Psc1Metadata | null;
  page: SpacePage;
  setPage: SetPage;
  /** The answer layers to draw, built by the route from the Page's answers. */
  layers: readonly Layer3D[];
  status: string | null;
  onError: (message: string | null) => void;
  /** The fixed top-left readout: the scene's summary, or the selection's identity and facts. */
  readout: ReactNode;
  legend: ReactNode;
  /** Filled here: the alias-click a Subject named in text calls. It selects and flies (N4). */
  alias?: { current: ((key: string) => void) | null };
}) {
  const subjects = useContext(SubjectTextContext);
  const [goHover, setGoHover] = useState<string | null>(null);
  const lit = useMemo(() => (goHover ? new Set([goHover]) : undefined), [goHover]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const size = useSize(host);
  const [framed, setFramed] = useState<Framed | null>(null);
  const [open, setOpen] = useState({ globe: true, top: true, north: true, east: true });
  const [thumbs, setThumbs] = useState<Partial<Record<PlaneAxis, HTMLCanvasElement | null>>>({});
  // Stable per axis: an inline ref is detached and reattached on every commit, and its setState
  // then re-renders forever (React's update-depth error on the first selection).
  const thumbRef = useMemo(
    () =>
      Object.fromEntries(
        PLANE_AXES.map((a) => [
          a,
          (el: HTMLCanvasElement | null) => setThumbs((t) => (t[a] === el ? t : { ...t, [a]: el })),
        ]),
      ) as Record<PlaneAxis, (el: HTMLCanvasElement | null) => void>,
    [],
  );
  /** The explicit 3D pose an axis was entered from; null = it was the fit, or no record (a URL entry). */
  const returnPose = useRef<OrbitViewport | null>(null);
  const on = useMemo(() => new Set<SpaceLayer>(page.layers), [page.layers]);
  const bounds = meshes?.bounds ?? null;
  const axis = page.mode === "3d" ? null : page.mode;

  const pose: OrbitViewport | null =
    page.viewport?.kind === "orbit" ? page.viewport : bounds ? frame(bounds) : null;
  /** The 3D pose under an axis: the one it left, else the fit. */
  const under = returnPose.current ?? (bounds ? frame(bounds) : null);
  const orbit = useLiveOrbit(
    axis ? under : pose,
    stageViewport(setPage),
    `${page.scene}/${page.ids.join(",")}/${page.mode}`,
    page.viewport,
  );
  const plane = useMemo(() => {
    if (!axis || !bounds || !size) return null;
    const viewport: PlaneViewport =
      page.viewport?.kind === "plane" ? page.viewport : fitPlane(axis, bounds, size);
    return { axis, viewport };
  }, [axis, bounds, size, page.viewport]);

  const toMode = (next: SpacePage["mode"]) => {
    if (next === page.mode) return;
    if (page.mode === "3d") returnPose.current = orbit.read();
    if (next !== "3d") return setPage({ mode: next }, push);
    setPage({ mode: "3d", viewport: returnPose.current }, push);
  };
  const selectedBounds = useMemo(
    () =>
      meshes && page.selected ? boundsOfInstances(meshes, (i) => i.key === page.selected) : null,
    [meshes, page.selected],
  );
  // The cuts, validated together; a URL can carry one that crosses itself, which clips nothing.
  const cut = useMemo((): { polygons: Polygons; error: string | null } | null => {
    if (!bounds) return null;
    try {
      return { polygons: cutPolygons(page.cuts, bounds), error: null };
    } catch (e) {
      return { polygons: { top: [], north: [], east: [] }, error: (e as Error).message };
    }
  }, [page.cuts, bounds]);
  const clipVolume = useMemo(
    () => (cut && bounds ? packPolygons(cut.polygons, page.cuts, center(bounds)) : null),
    [cut, bounds, page.cuts],
  );
  const clip = (hit: Pick) => !cut || retained(hit.point, page.cuts, cut.polygons);
  const onCuts = (next: Cuts, how: "push" | "replace") => {
    try {
      cutPolygons(next, bounds!);
    } catch (e) {
      return onError((e as Error).message);
    }
    onError(null);
    setPage({ cuts: next }, { history: how });
  };

  const selected = useMemo(() => new Set(page.selected ? [page.selected] : []), [page.selected]);
  const hidden = useMemo(() => new Set(page.hidden), [page.hidden]);
  const isolated = useMemo(() => {
    if (!meshes) return null;
    if (!on.has("meshes")) return new Set<string>();
    const shown = page.isolated ? new Set(page.isolated) : null;
    if (on.has("context")) return shown;
    return new Set(
      meshes.instances.filter((i) => i.focus && (!shown || shown.has(i.key))).map((i) => i.key),
    );
  }, [meshes, on, page.isolated]);

  useRouteLease("space", [page, setPage], {
    thread: lease?.thread,
    visible: !!lease?.ready && !!meshes && !!metadata && !!size,
    context: { ...lease?.context, bounds, size },
    facts: {
      pose: axis ? (plane?.viewport ?? null) : pose,
      size,
      bounds,
      modes: ["3d", "top", "north", "east"],
      layers: SPACE_LAYERS,
      fresh: metadata?.stamp.fresh ?? false,
      totalElements: metadata?.elements.length ?? 0,
      omittedElements: metadata?.omittedElements ?? 0,
      unavailableElements: metadata?.unavailableElements.length ?? 0,
      truncated: (metadata?.elements.length ?? 0) > 200,
      sources: (metadata?.stamp.sources ?? []).slice(0, 100),
      totalSources: metadata?.stamp.sources.length ?? 0,
      sourcesTruncated: (metadata?.stamp.sources.length ?? 0) > 100,
      cutError: cut?.error ?? null,
      visibilityMembersBeforeCuts:
        meshes?.instances.filter(
          (instance) => !hidden.has(instance.key) && (!isolated || isolated.has(instance.key)),
        ).length ?? 0,
      elements: (metadata?.elements ?? []).slice(0, 200).map((element) => ({
        key: spaceElementKey(element.handle),
        documentKey: element.handle.documentKey,
        linkInstanceId: element.handle.linkInstanceId ?? null,
        category: element.handle.category,
        bounds: element.bounds,
        focus: element.focus,
      })),
    },
  });

  // A click selects (a push, so Back undoes it) and never moves the camera; a click on nothing
  // keeps the selection, as on /ducts (Esc clears it).
  const onPick = (pick: Pick | null, event: MouseEvent) => {
    if (event.detail > 1) return;
    if (pick) {
      if (pick.instance.key !== page.selected)
        setPage({ selected: pick.instance.key, row: null }, push);
      return;
    }
    const rows = page.rows?.response;
    if (rows && on.has("boxes") && framed && host) {
      const r = host.getBoundingClientRect();
      const ray = framed.ray(event.clientX - r.left, event.clientY - r.top);
      const row = rowUnder(rows, ray.origin, ray.direction);
      if (row !== null && row !== page.row) setPage({ row, selected: null }, push);
    }
  };

  const box = useMemo(() => {
    if (!bounds) return undefined;
    const c = center(bounds);
    const k =
      0.8 /
      Math.max(
        Math.hypot(
          bounds.maxX - bounds.minX,
          bounds.maxY - bounds.minY,
          bounds.maxZ - bounds.minZ,
        ) / 2,
        1,
      );
    const xs = [bounds.minX, bounds.maxX],
      ys = [bounds.minY, bounds.maxY],
      zs = [bounds.minZ, bounds.maxZ];
    const corner = (i: number) =>
      [xs[i & 1]!, ys[(i >> 1) & 1]!, zs[(i >> 2) & 1]!].map((v, j) => (v - c[j]!) * k);
    const edges = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
    return Array.from({ length: edges.length / 2 }, (_, i) => [
      corner(edges[i * 2]!),
      corner(edges[i * 2 + 1]!),
    ]);
  }, [bounds]);

  // One element per orbit and box: a selection re-renders the picture, never the globe (it follows
  // the live orbit itself).
  const hasPose = !!pose;
  const globe = useMemo(
    () =>
      hasPose ? (
        <OrbitMinimap orbit={orbit} lines={box} />
      ) : (
        <p className="t-small text-ink-2 m-0 p-2">no scene yet</p>
      ),
    [hasPose, orbit, box],
  );
  const place = { top: "tl", north: "tl", east: "br" } as const;
  const floaters: FloaterSpec[] = [
    {
      key: "globe",
      label: "globe",
      chord: "G",
      says: "Show or hide the globe: drag it to turn the 3D camera, click a stop to look from there",
      place: "tr",
      open: open.globe && page.mode === "3d",
      onOpenChange: (globe) => setOpen({ ...open, globe }),
      render: () => globe,
    },
    ...PLANE_AXES.map(
      (a): FloaterSpec => ({
        key: a,
        label: `${AXIS_LABEL[a]} thumbnail`,
        says:
          a === axis
            ? "The 3D pose you left; a click returns to it"
            : `The ${AXIS_LABEL[a]} picture at its fit; a click shows it large`,
        place: place[a],
        size: { width: THUMB.width + 8, height: THUMB.height + 8 },
        open: open[a],
        onOpenChange: (next) => setOpen({ ...open, [a]: next }),
        render: () => (
          <Button
            kind="quiet"
            label={a === axis ? "Return to the 3D view (Esc)" : `Show the ${AXIS_LABEL[a]} picture`}
            pressed={a === axis}
            data-space-thumb={a}
            onClick={() => toMode(a === axis ? "3d" : a)}
          >
            <span className="pointer-events-none relative block" style={THUMB}>
              <canvas ref={thumbRef[a]} className="block size-full" />
              <span className="block px-1 t-small" data-surface="page">
                {a === axis ? "3D · Esc" : AXIS_LABEL[a]}
                {a !== axis && !page.cuts[a].polyline.length ? " · no cut" : ""}
              </span>
            </span>
          </Button>
        ),
      }),
    ),
  ];

  return (
    <PictureStage
      goTo={(stage) => (
        <GoToPopup
          hover={(item) => setGoHover(item?.key ?? null)}
          items={() =>
            (metadata?.elements ?? []).map((element) => ({
              key: spaceElementKey(element.handle),
              name:
                (!element.handle.linkInstanceId && subjects?.nameOf(element.handle.elementId)) ||
                pickName(element.handle),
              id: element.handle.elementId,
              revit: element.handle.linkInstanceId ? [] : [element.handle.elementId],
              detail: element.handle.uniqueId,
            }))
          }
          onGo={(item) => {
            setPage({ selected: item.key, row: null }, push);
            stage.frameOn(
              meshes ? boundsOfInstances(meshes, (instance) => instance.key === item.key) : null,
            );
          }}
        />
      )}
      {...{
        kind: "orbit",
        orbit,
        host,
        bounds: bounds && { scene: bounds, subject: bounds },
        selectedBounds,
        clearSelection: () => {
          if (page.selected || page.row !== null) setPage({ selected: null, row: null }, push);
        },
        // Pending N1 ruling: preserve Space's axis Escape-to-3D behavior explicitly.
        axis: axis
          ? {
              label: "return to 3D",
              escape: () => toMode("3d"),
              frame: () => setPage({ viewport: null }, push),
            }
          : null,
      }}
    >
      {(stage) => {
        const { frameOn, orbitPivot } = stage;
        if (alias)
          alias.current = (key) => {
            if (key !== page.selected) setPage({ selected: key, row: null }, push);
            frameOn(meshes ? boundsOfInstances(meshes, (i) => i.key === key) : null);
          };

        return (
          <Pane
            picture
            id="space-picture"
            legend={legend}
            title="Space"
            meta={
              metadata
                ? `${metadata.triangles.toLocaleString()} triangles · ${metadata.elements.length} elements`
                : undefined
            }
            actions={stage.goTo}
            flush
            scroll="clip"
            modes={{
              label: "picture mode",
              value: page.mode,
              onChange: (next) => toMode(next as SpacePage["mode"]),
              options: (["3d", "top", "north", "east"] as const).map((m, i) => ({
                key: m,
                label: MODE_LABEL[m],
                chord: String(i + 1) as Chord,
                says:
                  m === "3d"
                    ? "Orbit the scene"
                    : `Look at the ${MODE_LABEL[m]} axis orthographically and edit its cut`,
              })),
            }}
            layers={{
              value: page.layers,
              options: SPACE_LAYERS.map((l) => ({ key: l, label: l, says: LAYER_SAYS[l] })),
              onToggle: (l) =>
                setPage({ layers: toggleLayer(SPACE_LAYERS, page.layers, l as SpaceLayer) }),
            }}
            floaters={meshes ? floaters : undefined}
          >
            <div ref={setHost} className="relative min-h-0 min-w-0 flex-1" data-space-picture="">
              {meshes && pose && size ? (
                <Scene3D
                  readout={readout}
                  className="size-full"
                  meshes={meshes}
                  orbit={orbit}
                  orbitPivot={orbitPivot}
                  wheelHost={host}
                  plane={plane}
                  onPlane={stageViewport(setPage)}
                  thumbs={thumbs}
                  selected={selected}
                  lit={lit}
                  hidden={hidden}
                  isolated={isolated}
                  layers={layers}
                  clipVolume={clipVolume}
                  clip={clip}
                  onPick={onPick}
                  onDoubleClick={(pick) =>
                    frameOn(
                      pick && meshes
                        ? boundsOfInstances(meshes, (i) => i.key === pick.instance.key)
                        : null,
                    )
                  }
                  onProject={(project, at, ray, moving) => {
                    if (!moving && !orbit.moving()) setFramed({ project, size: at, ray });
                  }}
                />
              ) : null}
              {meshes && framed && on.has("cuts") ? (
                <CutOverlay
                  framed={framed}
                  bounds={meshes.bounds}
                  cuts={page.cuts}
                  editing={axis}
                  onCuts={onCuts}
                  onError={onError}
                />
              ) : null}
              {!meshes || !pose || !size ? readout : null}
              {status || cut?.error ? (
                <PaneOverlay label="space status" place="br">
                  <p role="status" className="t-small text-ink-2 m-0" data-space-status="">
                    {status ?? `cuts clip nothing: ${cut!.error}`}
                  </p>
                </PaneOverlay>
              ) : null}
            </div>
          </Pane>
        );
      }}
    </PictureStage>
  );
}
