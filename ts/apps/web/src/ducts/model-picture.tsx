import { RegistryContext } from "@effect/atom-react";
import { holdCitation } from "@pe/kit/lang/attention";
import { useWork } from "@pe/kit/lang/pane";
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
import { boundsOfInstances, boundsOfPoints, frame, type OrbitViewport } from "#/scene/orbit";
import type { PictureBounds } from "#/scene/framing";
import { useStage } from "#/scene/stage-controller";
import { viewportProject, type Project, type Size } from "#/scene/projection";
import { type LiveOrbit } from "@pe/kit/lang/live-orbit";
import { PaneOverlay } from "@pe/kit/lang/pane";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Scene3D } from "#/scene/scene3d";
import type { SceneRead } from "#/scene/use-scene";
import type { Bounds, Layer3D, SceneMeshes, PaintOf } from "#/scene/types";

import { CaptionBounds } from "./subject-labels";
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
    : bounds
      ? frame(bounds.scene, bounds.subject, undefined, size ? size.width / size.height : 1)
      : null;

export function ModelPicture({
  paintOf,
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
  paintOf?: PaintOf;
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
  useWork(read.pending, "capturing meshes… gestures wait");
  return (
    <div
      ref={setHost}
      data-model-picture=""
      inert={read.pending || undefined}
      aria-busy={read.pending || undefined}
      data-reading={read.pending ? "pending" : undefined}
      className="relative min-h-0 flex-1 overflow-hidden"
      onPointerMove={() => holdCitation(registry)}
    >
      {!read.pending && status && (
        <OutcomeLine kind={read.error ? "error" : "advisory"} label={status} />
      )}
      {meshes && pose ? (
        <Scene3D
          paintOf={paintOf}
          readout={readout}
          className="size-full"
          meshes={meshes}
          orbit={orbit}
          orbitPivot={stage.orbitPivot}
          wheelHost={wheelHost ?? host}
          selected={selectedKeys}
          lit={litKeys}
          isolated={layers.has("meshes") ? null : NONE}
          layers={findings3d}
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
      ) : (
        readout
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
      {overlay ? (
        <div
          ref={fade}
          className="pointer-events-none absolute inset-0 transition-opacity duration-150 data-flying:opacity-0"
        >
          <CaptionBounds.Provider value={overlay.size}>
            <Annotations
              {...overlay}
              scene={scene}
              layers={layers}
              encoding={encoding}
              selected={selected}
              hovered={hovered}
              labels={labels}
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
        </div>
      ) : null}
    </div>
  );
}
