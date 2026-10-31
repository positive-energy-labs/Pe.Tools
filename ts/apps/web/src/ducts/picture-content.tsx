/**
 * The ducts picture's shared content parts, for every ducts surface that mounts `Picture` (E and
 * the fan sheet): equipment paint and its ports layer, and the DOM overlay (captions, footnotes,
 * ruling pins). Picture behaviour stays in `scene/picture`; these are only marks.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useElementAttention } from "#/attention";
import { LOOK, paintOf as resolvePaint } from "#/scene/grounds";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { captionObstacles } from "#/scene/framing";
import { continuationAnchor } from "#/scene/continuations";
import { portLayer } from "#/scene/ports";
import type { ColourMode } from "#/scene/renderer";
import { systemPaint } from "#/scene/surfaces";
import type { Kinds, Layer3D, PaintOf, SceneMeshes } from "#/scene/types";
import { elementKey } from "@pe/kit/lang/attention";
import type { PictureLayer, PictureLine, PictureOverlayFrame } from "#/scene/picture/picture";
import { Annotations, type Label, type Ruling } from "./annotations";
import type { Encoding } from "./encoding";
import type { StageIssue } from "./inbox-rows";
import { equipmentPaint, equipmentPorts } from "./paint";
import type { Scene } from "./scene";
import { CaptionBounds } from "./subject-labels";

/** The scene's centrelines as the picture reads them: segments first, then node points. */
export const linesOf = (scene: Scene): PictureLine[] => [
  ...scene.segments.map((f) => ({ key: elementKey(f.segment.id), points: f.segment.polyline })),
  ...scene.nodes.map((f) => ({ key: elementKey(f.node.id), points: [f.node.point] })),
];

/** Equipment paint over the shown meshes, and the ports layer drawn from the same scene graph. */
export function useEquipment(
  scene: Scene,
  routePaint: PaintOf,
  kinds: Kinds,
  colour: ColourMode,
): { paint: (meshes: SceneMeshes | null) => PaintOf; ports: PictureLayer } {
  // Equipment reads as its scene graph sees it; one graph per shown meshes feeds paint and ports.
  const graphOf = useMemo(() => {
    const graphs = new WeakMap<object, ReturnType<Scene["graphOf"]>>();
    const none = {};
    return (meshes: SceneMeshes | null) => {
      const at = meshes ?? none;
      let graph = graphs.get(at);
      if (!graph)
        graphs.set(
          at,
          (graph = scene.graphOf(
            meshes?.instances.flatMap((i) =>
              i.revitId !== null &&
              i.linkInstanceId === null &&
              resolvePaint(i, routePaint).tier !== "context"
                ? [i.revitId]
                : [],
            ) ?? [],
          )),
        );
      return graph;
    };
  }, [scene, routePaint]);
  const paint = useCallback(
    (meshes: SceneMeshes | null) => {
      const paint = equipmentPaint(graphOf(meshes), routePaint);
      return meshes ? systemPaint(meshes, paint) : paint;
    },
    [graphOf, routePaint],
  );
  const look = useSyncExternalStore(knobsChanged, LOOK.read, LOOK.read);
  const ports = useMemo<PictureLayer>(
    () => ({
      key: "ports",
      draw: ({ meshes, paintOf }) =>
        meshes
          ? [
              portLayer(
                equipmentPorts(graphOf(meshes), meshes, paintOf ?? paint(meshes)),
                colour === "firm" ? kinds : {},
                look,
              ),
            ]
          : [],
    }),
    [graphOf, paint, colour, kinds, look],
  );
  return { paint, ports };
}

/** The ducts DOM marks over the picture: captions, footnotes and ruling pins, at the released frame. */
export function DuctsOverlay({
  frame,
  scene,
  layers,
  encoding,
  labels,
  rulings,
  covered: stageLayers,
  issues,
  pointOf,
  issue,
  onRuling,
}: {
  frame: PictureOverlayFrame;
  scene: Scene;
  layers: ReadonlySet<string>;
  encoding: Encoding;
  labels: readonly Label[];
  rulings: readonly Ruling[];
  /** The 3D marks drawn now: a ruling they carry draws no pin. */
  covered: readonly Layer3D[];
  issues: readonly StageIssue[];
  pointOf: (id: number) => readonly number[] | null;
  issue: string;
  onRuling: (r: Ruling) => void;
}) {
  const { hovered } = useElementAttention();
  const { meshes, paintOf, camera, size } = frame;
  const captionField = useMemo(
    () => ({
      ...size,
      obstacles:
        meshes && labels.some((label) => layers.has(label.stub ? "stub-labels" : "labels"))
          ? captionObstacles(meshes, camera, paintOf, size)
          : [],
    }),
    [frame.project, camera, size, meshes, paintOf, labels, layers], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const captionLabels = useMemo(
    () =>
      meshes
        ? labels.map((label) =>
            label.stub ? { ...label, at: continuationAnchor(meshes, label.ids, label.at) } : label,
          )
        : labels,
    [meshes, labels],
  );
  const meshed = useMemo(
    () =>
      new Set(
        layers.has("meshes")
          ? (meshes?.instances.flatMap((i) => (i.revitId == null ? [] : [i.revitId])) ?? [])
          : [],
      ),
    [meshes, layers.has("meshes")], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const covered = useMemo(
    () => new Set(stageLayers.flatMap((layer) => layer.findings ?? [])),
    [stageLayers],
  );
  const marks = rulings.filter(
    (r) =>
      !meshes ||
      !covered.has(
        r.kind === "claim"
          ? `claim:${r.claim.id}`
          : r.kind === "inferred"
            ? r.finding.id
            : r.issue.id,
      ),
  );
  return (
    <CaptionBounds.Provider value={captionField}>
      <Annotations
        project={frame.project}
        size={size}
        scene={scene}
        layers={layers}
        encoding={encoding}
        selected={frame.selected}
        hovered={hovered}
        labels={captionLabels}
        meshed={meshed}
        issues={issues}
        rulings={marks}
        pointOf={pointOf}
        issue={issue}
        onPick={frame.pick}
        onFrame={frame.frame}
        onRuling={onRuling}
      />
    </CaptionBounds.Provider>
  );
}
