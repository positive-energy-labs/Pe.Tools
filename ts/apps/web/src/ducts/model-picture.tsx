import { RegistryContext } from "@effect/atom-react";
import { holdCitation } from "@pe/kit/lang/attention";
import { useWork } from "@pe/kit/lang/work";
/** The subject's real meshes and annotations. Camera policy belongs to useStage. */
import { emptyListSearch } from "@pe/agent-contracts";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { PageMove } from "#/route/manifest";
import type { SceneView } from "@pe/agent-contracts";
import { LOOK, paintOf as resolvePaint } from "#/scene/grounds";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { fitSection, sectionVolume, type Section } from "#/scene/section";
import { SectionControls, SectionHandles } from "#/scene/section-controls";
import { boundsOfInstances, boundsOfPoints, frame, type OrbitViewport } from "#/scene/orbit";
import type { PictureBounds } from "#/scene/framing";
import { framingPoints, captionObstacles } from "#/scene/framing";
import { useStage } from "#/scene/stage-controller";
import { sectionProject, viewportProject, type Project, type Size } from "#/scene/projection";
import { continuationAnchor, ContinuationMarks } from "#/scene/continuations";
import { type LiveOrbit } from "@pe/kit/lang/live-orbit";
import { PaneOverlay } from "@pe/kit/lang/pane";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Scene3D } from "#/scene/scene3d";
import type { SceneRead } from "#/scene/use-scene";
import type { Bounds, Layer3D, PaintOf, SceneMeshes } from "#/scene/types";

import { CaptionBounds } from "./subject-labels";
import { equipmentPaint, equipmentPorts } from "./paint";
import { portLayer } from "#/scene/ports";
import { systemPaint } from "#/scene/surfaces";
import { Annotations, type Label, type Ruling } from "./annotations";
import type { Encoding } from "./encoding";
import type { DuctsPage } from "./manifest";
import type { Scene } from "./scene";
import type { StageIssue } from "./inbox-rows";
import type { IssueTarget } from "#/scene/types";

const NONE: ReadonlySet<string> = new Set();

const centrelinePoints = (scene: Scene, ids?: ReadonlySet<number>) => [
  ...scene.segments.flatMap((f) => (!ids || ids.has(f.segment.id) ? f.segment.polyline : [])),
  ...scene.nodes.flatMap((f) => (!ids || ids.has(f.node.id) ? [f.node.point] : [])),
];

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

export function usePictureBounds(meshes: SceneMeshes | null, scene: Scene): PictureBounds | null {
  return useMemo(() => {
    if (meshes)
      return {
        scene: meshes.bounds,
        subject: boundsOfInstances(meshes, (i) => i.focus) ?? meshes.bounds,
        points: () => framingPoints(meshes),
      };
    const own = boundsOfPoints(centrelinePoints(scene));
    return own && { scene: own, subject: own };
  }, [meshes, scene]);
}

/** The pose the picture shows: the page's, else the fit of the subject; null with nothing to fit. */
export const poseOf = (
  viewport: DuctsPage["viewport"],
  bounds: PictureBounds | null,
  size?: Size | null,
): OrbitViewport | null =>
  viewport?.kind === "orbit"
    ? viewport
    : bounds && size
      ? frame(bounds.scene, bounds.subject, undefined, size.width / size.height, bounds.points?.())
      : null;

export function ModelPicture({
  readout,
  read,
  bounds,
  orbit,
  wheelHost,
  scene,
  layers,
  encoding,
  selected,
  lit,
  paintOf: routePaint,
  contextMode,
  contextRadiusFt,
  sceneView,
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
}: {
  readout: ReactNode;
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
  paintOf?: PaintOf;
  contextMode?: "halo" | "all";
  contextRadiusFt?: number;
  sceneView: SceneView;
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
}) {
  const stage = useStage();
  const meshes = read.meshes;
  const graph = useMemo(
    () =>
      scene.graphOf(
        meshes?.instances.flatMap((i) =>
          i.revitId !== null &&
          i.linkInstanceId === null &&
          resolvePaint(i, routePaint).tier !== "context"
            ? [i.revitId]
            : [],
        ) ?? [],
      ),
    [scene, meshes, routePaint],
  );
  const paintOf = useMemo(() => {
    const paint = equipmentPaint(graph, routePaint);
    return meshes ? systemPaint(meshes, paint) : paint;
  }, [graph, meshes, routePaint]);
  const sectionSubject = useMemo(
    () =>
      meshes
        ? (boundsOfInstances(meshes, (i) => (paintOf ? paintOf(i)?.tier === "subject" : i.focus)) ??
          bounds?.subject ??
          null)
        : (bounds?.subject ?? null),
    [meshes, paintOf, bounds],
  );
  const look = useSyncExternalStore(knobsChanged, LOOK.read, LOOK.read);
  const pictureLayers = useMemo(
    () =>
      meshes
        ? [...findings3d, portLayer(equipmentPorts(graph, meshes, paintOf), look)]
        : findings3d,
    [graph, meshes, paintOf, findings3d, look],
  );
  const preset = look.layers.preset === "page" ? sceneView.preset : look.layers.preset;
  const [sectionDraft, setSectionDraft] = useState<Section | undefined>();
  const section = sectionDraft ?? sceneView.section;
  const clipVolume = useMemo(() => {
    const cut =
      section ??
      (look.layers.preset === "nearby-structure" && sectionSubject
        ? fitSection(sectionSubject, look.section.paddingFt)
        : null);
    const volume = sectionVolume(cut);
    return volume && { ...volume, preview: sectionDraft !== undefined };
  }, [section, sectionSubject, look.layers.preset, look.section.paddingFt, sectionDraft]);
  const shownView = { preset, section: clipVolume?.section ?? null };
  const commitSection = (next: Section) => {
    setSectionDraft(undefined);
    setPage({ sceneView: { ...sceneView, section: next } }, { history: "replace" });
  };
  const registry = useContext(RegistryContext);
  const pickIssue = (target: IssueTarget) => {
    setPage(
      { selected: String(target.elementId), issue: target.key, rulingSearch: emptyListSearch() },
      { history: "push" },
    );
  };
  const hoverIssue = (target: IssueTarget | null) => {
    onIssueHover(target?.key ?? null);
  };
  // Meshes move natively during a gesture; DOM annotations re-project only at release.
  const held = useRef<OrbitViewport | null>(null);
  const pose = useSyncExternalStore(orbit.subscribe, () =>
    meshes && held.current && orbit.moving() ? held.current : (held.current = orbit.read()),
  );
  const fade = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!meshes) return;
    return orbit.subscribe(() => {
      const flying = orbit.moving();
      if (fade.current && (fade.current.dataset.flying === "") !== flying)
        if (flying) fade.current.dataset.flying = "";
        else delete fade.current.dataset.flying;
    });
  }, [orbit, meshes]);
  const [said, setSaid] = useState<string | null>(null);
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
  const [framed, setFramed] = useState<{ project: Project; size: Size } | null>(null);
  const lastFrame = useRef(framed);
  useEffect(() => {
    if (lastFrame.current !== framed && !orbit.moving()) setFramed(lastFrame.current);
  }, [pose]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = meshes
    ? framed
    : pose && bounds && size
      ? { project: viewportProject(pose, bounds.scene, size), size }
      : null;
  const annotationProject = overlay && sectionProject(overlay.project, shownView.section);
  const captionField = useMemo(
    () =>
      overlay &&
      annotationProject && {
        ...overlay.size,
        obstacles:
          meshes && labels.some((label) => layers.has(label.stub ? "stub-labels" : "labels"))
            ? captionObstacles(meshes, overlay.project, paintOf, overlay.size)
            : [],
      },
    [overlay, shownView.section, meshes, paintOf, labels, layers],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const captionLabels = useMemo(
    () =>
      meshes
        ? labels.map((label) =>
            label.stub ? { ...label, at: continuationAnchor(meshes, label.ids, label.at) } : label,
          )
        : labels,
    [meshes, labels],
  );

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
  const meshed = useMemo(
    () =>
      new Set(
        layers.has("meshes")
          ? (meshes?.instances.flatMap((i) => (i.revitId == null ? [] : [i.revitId])) ?? [])
          : [],
      ),
    [meshes, layers.has("meshes")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const frameAt = (key: string | null) =>
    stage.frameOn(key && meshes ? boundsOfInstances(meshes, (i) => i.key === key) : null);

  const status =
    said ??
    (read.error
      ? `scene: ${read.error}`
      : !meshes
        ? "no meshes: choose a system on a Revit document"
        : null);
  useWork(read.pending, "capturing meshes…");
  return (
    <div
      ref={setHost}
      data-model-picture=""
      aria-busy={read.pending || undefined}
      data-reading={read.pending ? "pending" : undefined}
      className="relative min-h-0 flex-1 overflow-hidden"
      onPointerMove={() => holdCitation(registry)}
    >
      {!read.pending && status && (
        <OutcomeLine kind={read.error ? "error" : "advisory"} label={status} />
      )}
      <Scene3D
        readout={readout}
        className="size-full"
        meshes={meshes}
        focusMeshes={read.focusMeshes}
        pickingEnabled={!read.pending || read.focusReady === true}
        orbit={orbit}
        orbitPivot={stage.orbitPivot}
        wheelHost={wheelHost ?? host}
        selected={selectedKeys}
        lit={litKeys}
        paintOf={paintOf}
        contextMode={preset === "nearby-structure" ? "halo" : contextMode}
        contextRadiusFt={contextRadiusFt}
        preset={preset}
        clipVolume={clipVolume}
        isolated={layers.has("meshes") ? null : NONE}
        layers={pictureLayers}
        hoveredIssue={hoveredIssue}
        focusedIssue={issue}
        onIssueHover={hoverIssue}
        onIssuePick={pickIssue}
        onProject={(project, at, _ray, moving) => {
          lastFrame.current = { project, size: at };
          if (!moving && !orbit.moving()) setFramed(lastFrame.current);
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
      {meshes && sectionSubject && (
        <PaneOverlay label="section and context" place="tr">
          <SectionControls
            view={shownView}
            subject={sectionSubject}
            padding={look.section.paddingFt}
            proximity={
              contextRadiusFt === undefined
                ? undefined
                : {
                    radiusFt: contextRadiusFt,
                    onChange: (radius) =>
                      setPage({ contextRadiusFt: radius }, { history: "replace" }),
                  }
            }
            onChange={(next) => {
              setSectionDraft(undefined);
              setPage({ sceneView: next }, { history: "push" });
            }}
          />
        </PaneOverlay>
      )}
      {read.omittedElements || read.unavailableElements ? (
        <PaneOverlay label="scene completeness" place="br">
          <OutcomeLine
            kind="advisory"
            label={[
              read.omittedElements
                ? `context: ${read.omittedElements} elements omitted at the triangle budget`
                : "",
              read.unavailableElements ? `${read.unavailableElements} unavailable` : "",
            ]
              .filter(Boolean)
              .join(" / ")}
          />
        </PaneOverlay>
      ) : null}
      {overlay && annotationProject ? (
        <div
          inert={read.pending || undefined}
          ref={fade}
          className="pointer-events-none absolute inset-0 transition-opacity duration-150 data-flying:opacity-0"
        >
          <CaptionBounds.Provider value={captionField}>
            {meshes && (
              <svg className="pointer-events-none absolute inset-0 size-full">
                <ContinuationMarks meshes={meshes} project={annotationProject} />
              </svg>
            )}
            <Annotations
              {...overlay}
              project={annotationProject}
              scene={scene}
              layers={layers}
              encoding={encoding}
              selected={selected}
              hovered={hovered}
              labels={captionLabels}
              meshed={meshed}
              issues={issues}
              rulings={rulings}
              pointOf={pointOf}
              issue={issue}
              onPick={onPick}
              onFrame={(id) =>
                frameAt(meshes?.instances.find((i) => i.revitId === id)?.key ?? null)
              }
              onRuling={onRuling}
            />
          </CaptionBounds.Provider>
          {meshes && sectionSubject && shownView.section && (
            <SectionHandles
              section={shownView.section}
              subject={sectionSubject}
              project={overlay.project}
              onPreview={setSectionDraft}
              onCommit={commitSection}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
