import { RegistryContext } from "@effect/atom-react";
import { holdCitation, type SubjectKey } from "@pe/kit/lang/attention";
import { useWork } from "@pe/kit/lang/work";
/** The subject's real meshes, section and completeness; a surface's marks arrive as layers and the
 * overlay. Camera policy belongs to useStage. */
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { PicturePage, SceneView } from "@pe/agent-contracts";
import { LOOK } from "#/scene/grounds";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { fitSection, sectionVolume, type Section } from "#/scene/section";
import { SectionControls, SectionHandles } from "#/scene/section-controls";
import { boundsOfInstances, boundsOfPoints, frame, type OrbitViewport } from "#/scene/orbit";
import type { PictureBounds } from "#/scene/framing";
import { framingPoints } from "#/scene/framing";
import { useStage } from "#/scene/stage-controller";
import { sectionProject, viewportProject, type Project, type Size } from "#/scene/projection";
import { ContinuationMarks } from "#/scene/continuations";
import { type LiveOrbit } from "@pe/kit/lang/live-orbit";
import { PaneOverlay } from "@pe/kit/lang/pane";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import { Scene3D } from "#/scene/scene3d";
import type { SceneRead } from "#/scene/use-scene";
import type { Bounds, IssueTarget, Kinds, Layer3D, PaintOf, SceneMeshes } from "#/scene/types";
import type { ColourMode, ContextMode } from "#/scene/renderer";

const NONE: ReadonlySet<string> = new Set();
const CONTEXT_LIMITS: Record<string, string> = {
  "output-budget": "Context limited by geometry budget",
  "acquisition-budget": "Context limited by geometry budget",
  "memory-growth": "Context limited to protect Revit memory",
  "memory-headroom": "Context limited to protect Revit memory",
  "element-acquisition-limit": "Some context elements exceed the geometry limit",
};

/** A drawn subject's centreline in world feet, where it sits before (or without) its meshes. One
 * point is a point subject (a fitting); two or more are a line the globe draws. */
export type PictureLine = { key: SubjectKey; points: readonly (readonly number[])[] };
/** One ordered path through the picture's elements: a terminal run, a home run, a circuit. Strands
 * that share an element ride side by side through it, and `path` order is the flow direction. */
export type PictureStrand = {
  /** The strand's own subject (`run:<id>`): a pick on its line selects it, a row lights it. */
  key: SubjectKey;
  /** Element keys in flow order; each needs a centreline in `lines`. */
  path: readonly SubjectKey[];
  /** The governing strand (the critical run): drawn heavy and always flowing. */
  heavy?: boolean;
};
/** Numeric element ids stop here: the renderer adapter speaks `revitId`, the picture `e:` keys. */
export const idOf = (key: SubjectKey) => (key.startsWith("e:") ? Number(key.slice(2)) : NaN);

const centrelinePoints = (lines: readonly PictureLine[], ids?: ReadonlySet<number>) =>
  lines.flatMap((line) => (!ids || ids.has(idOf(line.key)) ? line.points : []));

/** Where elements sit: their meshes', else their centrelines'; null when none is drawn. */
export function boundsOfIds(
  meshes: SceneMeshes | null,
  lines: readonly PictureLine[],
  ids: ReadonlySet<number>,
): Bounds | null {
  return (
    (meshes && boundsOfInstances(meshes, (i) => i.revitId !== null && ids.has(i.revitId))) ??
    boundsOfPoints(centrelinePoints(lines, ids))
  );
}

export function usePictureBounds(
  meshes: SceneMeshes | null,
  lines: readonly PictureLine[],
): PictureBounds | null {
  return useMemo(() => {
    if (meshes)
      return {
        scene: meshes.bounds,
        subject: boundsOfInstances(meshes, (i) => i.focus) ?? meshes.bounds,
        points: () => framingPoints(meshes),
      };
    const own = boundsOfPoints(centrelinePoints(lines));
    return own && { scene: own, subject: own };
  }, [meshes, lines]);
}

/** What a surface's overlay draws against: the released frame, never a mid-gesture one. */
export type PictureOverlayFrame = {
  /** World feet to overlay px, with the shown section applied. */
  project: Project;
  /** The same camera without the section: what occludes on screen. */
  camera: Project;
  size: Size;
  meshes: SceneMeshes | null;
  paintOf: PaintOf | undefined;
  /** The picture's selection (widened), as element ids. */
  selected: ReadonlySet<number>;
  /** The picture's pick and frame (double-click) verbs. */
  pick: (id: number, at: { x: number; y: number }) => void;
  frame: (id: number) => void;
};
/** A surface's 3D marks. `toggle` names the page layer that gates it; absent = always drawn. */
export type PictureLayer = {
  key: string;
  toggle?: string;
  draw: (ctx: { meshes: SceneMeshes | null; paintOf: PaintOf | undefined }) => readonly Layer3D[];
};

/** The pose the picture shows: the page's, else the fit of the subject; null with nothing to fit. */
export const poseOf = (
  viewport: PicturePage["viewport"],
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
  capturing,
  bounds,
  orbit,
  wheelHost,
  layers,
  selected,
  lit,
  paint,
  contextMode,
  contextRadiusFt,
  contextRepresentation = "boxes",
  onContextRepresentation,
  kinds,
  colour,
  sceneView,
  drawn,
  overlay: drawOverlay,
  hoveredIssue,
  onIssueHover,
  onIssuePick,
  issue,
  setPage,
  onPick,
  onClear,
}: {
  readout: ReactNode;
  read: SceneRead;
  capturing: boolean;
  bounds: PictureBounds | null;
  orbit: LiveOrbit;
  wheelHost?: HTMLElement | null;
  /** The page's layer keys; `meshes` is the scene's own (off isolates nothing drawn). */
  layers: ReadonlySet<string>;
  /** Element ids: the selection (widened), and what a hovered subject elsewhere lights. */
  selected: ReadonlySet<number>;
  lit: ReadonlySet<number>;
  /** The surface's paint over the shown meshes; absent: focus is the subject. */
  paint?: (meshes: SceneMeshes | null) => PaintOf | undefined;
  contextMode?: ContextMode;
  contextRadiusFt?: number;
  contextRepresentation?: "boxes" | "meshes";
  onContextRepresentation?: (representation: "boxes" | "meshes") => void;
  /** Kind to hue and the Colour dial: the two inputs of the paint seam. */
  kinds: Kinds;
  colour: ColourMode;
  sceneView: SceneView;
  /** The surface's layers, already gated by their toggles. */
  drawn: readonly PictureLayer[];
  /** DOM the surface draws over the picture at the released frame (labels, pins, callouts). */
  overlay?: (frame: PictureOverlayFrame) => ReactNode;
  hoveredIssue: string | null;
  /** The mark under the pointer: an issue, or a mark that is its own subject (a strand). */
  onIssueHover: (target: IssueTarget | null) => void;
  onIssuePick: (target: IssueTarget) => void;
  issue: string;
  setPage: (
    next: Partial<Pick<PicturePage, "sceneView" | "contextRadiusFt">>,
    move?: { history: "push" | "replace" },
  ) => void;
  onPick: (id: number, at: { x: number; y: number }) => void;
  /** A click on empty picture: the page's selection goes, as Escape clears it. */
  onClear: () => void;
}) {
  const stage = useStage();
  const meshes = read.meshes;
  const paintOf = useMemo(() => paint?.(meshes), [paint, meshes]);
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
  const pictureLayers = useMemo(
    () => drawn.flatMap((layer) => layer.draw({ meshes, paintOf })),
    [drawn, meshes, paintOf],
  );
  const commitSection = (next: Section) => {
    setSectionDraft(undefined);
    setPage({ sceneView: { ...sceneView, section: next } }, { history: "replace" });
  };
  const registry = useContext(RegistryContext);
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

  const frameAt = (key: string | null) =>
    stage.frameOn(key && meshes ? boundsOfInstances(meshes, (i) => i.key === key) : null);

  const status =
    said ??
    (read.error
      ? `scene: ${read.error}`
      : !meshes
        ? "no meshes: choose a system on a Revit document"
        : null);
  useWork(capturing, "capturing meshes…");
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
        contextMode={preset === "nearby-structure" ? "lines" : contextMode}
        kinds={kinds}
        colour={colour}
        contextRadiusFt={contextRadiusFt}
        preset={preset}
        clipVolume={clipVolume}
        isolated={layers.has("meshes") ? null : NONE}
        layers={pictureLayers}
        hoveredIssue={hoveredIssue}
        focusedIssue={issue}
        onIssueHover={onIssueHover}
        onIssuePick={onIssuePick}
        onProject={(project, at, _ray, moving) => {
          lastFrame.current = { project, size: at };
          if (!moving && !orbit.moving()) setFramed(lastFrame.current);
        }}
        onDoubleClick={(pick) => frameAt(pick?.instance.key ?? null)}
        onPick={(pick, event) => {
          if (event.detail > 1) return;
          if (!pick) return onClear();
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
      {(onContextRepresentation && contextMode !== "off") ||
      read.completeness?.complete === false ||
      read.contextError ||
      read.omittedElements ||
      read.unavailableElements ? (
        <PaneOverlay label="scene completeness" place="br">
          <OutcomeLine
            kind="advisory"
            label={[
              onContextRepresentation
                ? contextRepresentation === "boxes"
                  ? "Simplified context"
                  : "Detailed context"
                : "",
              read.contextError ? `context: ${read.contextError}` : "",
              read.completeness?.complete === false
                ? (CONTEXT_LIMITS[read.completeness.limitReason ?? ""] ?? "Context limited")
                : "",
              read.completeness?.deferredCandidates === null
                ? "Additional context deferred"
                : read.completeness?.deferredCandidates
                  ? `${read.completeness.deferredCandidates} deferred`
                  : "",
              read.completeness?.acquisitionLimitedElements
                ? `${read.completeness.acquisitionLimitedElements} geometry limited`
                : "",
              read.omittedElements ? `${read.omittedElements} omitted at the geometry limit` : "",
              read.unavailableElements ? `${read.unavailableElements} unavailable` : "",
            ]
              .filter(Boolean)
              .join(" / ")}
          />
          {onContextRepresentation && contextMode !== "off" ? (
            <Button
              label={
                contextRepresentation === "boxes"
                  ? "Read detailed context"
                  : "Use simplified context"
              }
              busy={read.pending}
              onClick={() =>
                onContextRepresentation(contextRepresentation === "boxes" ? "meshes" : "boxes")
              }
            >
              {contextRepresentation === "boxes"
                ? "Read detailed context"
                : "Use simplified context"}
            </Button>
          ) : null}
        </PaneOverlay>
      ) : null}
      {overlay && annotationProject ? (
        <div
          inert={read.pending || undefined}
          ref={fade}
          className="pointer-events-none absolute inset-0 transition-opacity duration-150 data-flying:opacity-0"
        >
          {meshes && (
            <svg className="pointer-events-none absolute inset-0 size-full">
              <ContinuationMarks meshes={meshes} project={annotationProject} />
            </svg>
          )}
          {drawOverlay?.({
            project: annotationProject,
            camera: overlay.project,
            size: overlay.size,
            meshes,
            paintOf,
            selected,
            pick: onPick,
            frame: (id) => frameAt(meshes?.instances.find((i) => i.revitId === id)?.key ?? null),
          })}
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
