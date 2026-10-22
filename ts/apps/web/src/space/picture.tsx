/**
 * The /space picture: one pane whose strip holds the modes (3D, Top, North, East), the layers and
 * the floaters (the orbit globe, three axis thumbnails). `page.viewport` null is the fit of the
 * mode. Entering an axis keeps the 3D pose it left in a local record; Esc (or the 3D mode, or the
 * shown axis's thumbnail) restores it in one move. A URL that lands in an axis has no record, so
 * that return fits. The cuts draw over the picture as DOM and clip it in the shader.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useScopeKeys, type Chord } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { tokenRef } from "@pe/kit/lib/token";
import type { FloaterSpec } from "#/components/lang/floater";
import { OrbitMinimap } from "#/components/lang/minimap";
import { Pane } from "#/components/lang/pane";
import type { PageMove } from "#/route/manifest";
import { center, frame, type OrbitViewport } from "#/scene/orbit";
import {
  AXIS_LABEL,
  PLANE_AXES,
  fitPlane,
  type PlaneAxis,
  type PlaneViewport,
} from "#/scene/plane";
import type { Psc1Metadata } from "#/scene/psc1";
import { Scene3D } from "#/scene/scene3d";
import type { Layer3D, Pick, SceneMeshes } from "#/scene/types";

import { CutOverlay, type Framed } from "./cuts";
import { LAYER_SAYS, SPACE_LAYERS, rowUnder, type SpaceLayer } from "./layers";
import type { SpacePage } from "./manifest";
import { cutPolygons, packPolygons, retained, type Cuts, type Polygons } from "./state";
import { useRouteViewBridge } from "#/route/view-bridge";
import { spaceElementKey } from "@pe/agent-contracts";

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
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const size = useSize(host);
  const [framed, setFramed] = useState<Framed | null>(null);
  const [open, setOpen] = useState({ globe: true, top: true, north: true, east: true });
  const [thumbs, setThumbs] = useState<Partial<Record<PlaneAxis, HTMLCanvasElement | null>>>({});
  /** The explicit 3D pose an axis was entered from; null = it was the fit, or no record (a URL entry). */
  const returnPose = useRef<OrbitViewport | null>(null);
  const on = useMemo(() => new Set<SpaceLayer>(page.layers), [page.layers]);
  const bounds = meshes?.bounds ?? null;
  const axis = page.mode === "3d" ? null : page.mode;

  const pose: OrbitViewport | null =
    page.viewport?.kind === "orbit" ? page.viewport : bounds ? frame(bounds) : null;
  /** The 3D pose under an axis: the one it left, else the fit. */
  const under = returnPose.current ?? (bounds ? frame(bounds) : null);
  const plane = useMemo(() => {
    if (!axis || !bounds || !size) return null;
    const viewport: PlaneViewport =
      page.viewport?.kind === "plane" ? page.viewport : fitPlane(axis, bounds, size);
    return { axis, viewport };
  }, [axis, bounds, size, page.viewport]);

  const toMode = (next: SpacePage["mode"]) => {
    if (next === page.mode) return;
    if (page.mode === "3d")
      returnPose.current = page.viewport?.kind === "orbit" ? page.viewport : null;
    if (next !== "3d") return setPage({ mode: next }, push);
    setPage({ mode: "3d", viewport: returnPose.current }, push);
  };
  useScopeKeys([
    {
      hotkey: "Escape",
      label: "return to 3D",
      says: "Leave the axis picture for the 3D pose you left (a fit when there is none)",
      available: () => axis !== null,
      callback: () => toMode("3d"),
    },
  ]);

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

  useRouteViewBridge({
    route: "space",
    thread: lease?.thread,
    surface: "route",
    visible: !!lease?.ready && !!meshes && !!metadata && !!size,
    page,
    apply: (patch) => setPage(patch as Partial<SpacePage>, push),
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

  const onPick = (pick: Pick | null, event: PointerEvent) => {
    if (pick) return setPage({ selected: pick.instance.key, row: null }, push);
    const rows = page.rows?.response;
    if (rows && on.has("boxes") && framed && host) {
      const r = host.getBoundingClientRect();
      const ray = framed.ray(event.clientX - r.left, event.clientY - r.top);
      const row = rowUnder(rows, ray.origin, ray.direction);
      if (row !== null) return setPage({ row, selected: null }, push);
    }
    if (page.selected || page.row !== null) setPage({ selected: null, row: null }, push);
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
    return (project: (p: readonly number[]) => [number, number]) => (
      <path
        d={edges
          .map((e, i) => {
            const [x, y] = project(corner(e));
            return `${i % 2 ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join("")}
        fill="none"
        stroke={tokenRef("ink-2")}
        strokeOpacity={0.75}
      />
    );
  }, [bounds]);

  const place = { top: "tl", north: "bl", east: "br" } as const;
  const floaters: FloaterSpec[] = [
    {
      key: "globe",
      label: "globe",
      chord: "G",
      says: "Show or hide the globe: drag it to turn the 3D camera, click a stop to look from there",
      place: "tr",
      open: open.globe && page.mode === "3d",
      onOpenChange: (globe) => setOpen({ ...open, globe }),
      render: () =>
        pose ? (
          <OrbitMinimap
            viewport={pose}
            onViewport={(viewport, how) =>
              setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" })
            }
            paint={box}
          />
        ) : (
          <p className="t-small text-ink-2 m-0 p-2">no scene yet</p>
        ),
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
              <canvas
                ref={(el) => {
                  if (thumbs[a] !== el) setThumbs((t) => ({ ...t, [a]: el }));
                }}
                className="block size-full"
              />
              <span className="absolute left-1 top-1 px-1 t-small" data-surface="page">
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
    <Pane
      id="space-picture"
      title="Space"
      meta={
        metadata
          ? `${metadata.triangles.toLocaleString()} triangles · ${metadata.elements.length} elements`
          : undefined
      }
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
          setPage({
            layers: on.has(l as SpaceLayer)
              ? page.layers.filter((x) => x !== l)
              : SPACE_LAYERS.filter((x) => x === l || on.has(x)),
          }),
      }}
      floaters={meshes ? floaters : undefined}
    >
      <div ref={setHost} className="relative min-h-0 min-w-0 flex-1" data-space-picture="">
        {meshes && pose && size ? (
          <Scene3D
            className="size-full"
            meshes={meshes}
            viewport={axis ? (under ?? pose) : pose}
            onViewport={(viewport, how) =>
              setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" })
            }
            plane={plane}
            onPlane={(viewport, how) =>
              setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" })
            }
            thumbs={thumbs}
            selected={selected}
            hidden={hidden}
            isolated={isolated}
            layers={layers}
            clipVolume={clipVolume}
            clip={clip}
            onPick={onPick}
            onProject={(project, at, ray) => setFramed({ project, size: at, ray })}
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
        {status || cut?.error ? (
          <p
            role="status"
            className="t-small text-ink-2 absolute bottom-2 left-1/2 m-0 -translate-x-1/2"
            data-space-status=""
          >
            {status ?? `cuts clip nothing: ${cut!.error}`}
          </p>
        ) : null}
      </div>
    </Pane>
  );
}
