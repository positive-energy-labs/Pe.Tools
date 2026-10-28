/**
 * The one route-level picture. It owns every picture behaviour: capture with context, retention,
 * pose and orbit, stage verbs, selection and member registration on attention, hover (with the
 * reverse group expansion), globe, go-to, section, completeness, the readout and pane furniture.
 * A surface hands it content only and writes no other picture code. Content may change freely:
 * capture keys on the document and the focus, the camera on the document and the picture mode,
 * so neither remounts when a view or variant swaps its content.
 */
import type * as Atom from "effect/unstable/reactivity/Atom";
import { useAtomValue } from "@effect/atom-react";
import {
  AttentionDocument,
  elementKey,
  hovered as hoveredRef,
  useAttentionDocument,
  useMembers,
  type Members,
  type SubjectKey,
} from "@pe/kit/lang/attention";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { Button } from "@pe/kit/lang/button";
import { land } from "@pe/kit/lang/land";
import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
import type { Chord } from "@pe/kit/keys";
import { PictureReadout } from "@pe/kit/lang/readout";
import { nameOrFallback } from "@pe/kit/lang/subject-text";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { toggleLayer, type PicturePage } from "@pe/agent-contracts";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { useElementAttention, useHoveredIssue, useIssueHover } from "#/attention";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements, useNativeObservation } from "#/revit/observation";
import { sceneRequest, type ContextRepresentation } from "#/scene/host";
import type { OrbitViewport } from "#/scene/orbit";
import { viewportProject } from "#/scene/projection";
import type { ColourMode } from "#/scene/renderer";
import { PictureStage, projectBounds, stageViewport, useStage } from "#/scene/stage-controller";
import { PICTURE_MODES } from "#/scene/stage-teaching";
import type { Bounds, IssueTarget, Kinds, PaintOf, SceneMeshes } from "#/scene/types";

import { usePictureFloaters } from "./floaters";
import {
  boundsOfIds,
  idOf,
  ModelPicture,
  poseOf,
  usePictureBounds,
  type PictureLayer,
  type PictureLine,
  type PictureOverlayFrame,
} from "./model";
import { useCapture, usePictureRead } from "./read";

export { idOf, type PictureLayer, type PictureLine, type PictureOverlayFrame };

/** Everything a surface says about its picture. Numeric ids stop at the renderer adapter. */
export interface PictureContent<L extends string = string> {
  /** What is captured: `walked` draws as ink, `near` joins the capture as stubs. Never implies reach. */
  focus: { walked: readonly SubjectKey[]; near: readonly SubjectKey[] };
  /** Group subjects (issue:, run:, leg:, system:) to their element keys; the core registers them. */
  members?: Members;
  /** Reverse hover: an element lights the smallest declared group this admits. Absent = off. */
  hoverGroups?: (group: SubjectKey) => boolean;
  /** A picked element's selection, widened (its leg); absent = the element alone. */
  widen?: (key: SubjectKey) => readonly SubjectKey[];
  /** Capture limits and clipping; `meshes` substitutes a dev fixture for the capture. */
  capture?: { maxTriangles?: number; cuts?: SceneMeshes["cuts"]; meshes?: SceneMeshes | null };
  /** Centrelines: bounds before meshes arrive, the jump fallback, and the globe's lines. */
  lines: readonly PictureLine[];
  /** A subject's name as the surface's rows read it. */
  name: (key: SubjectKey) => string;
  paint?: (meshes: SceneMeshes | null) => PaintOf | undefined;
  kinds: Kinds;
  colour: ColourMode;
  layers?: readonly PictureLayer[];
  /** The layer strip, in order. `meshes`, `context` and `halo` are the scene's own keys. */
  layerOptions: readonly { key: L; label: string; chord?: Chord; says?: string }[];
  /** DOM drawn over the picture at the released frame. */
  overlay?: (frame: PictureOverlayFrame) => ReactNode;
  readout: {
    /** What the picture is of (a system name). */
    subject?: string;
    /** The idle line and body, while nothing is picked. */
    summary: ReactNode;
    idle?: ReactNode;
    /** The picked element's facts. */
    facts?: (key: SubjectKey) => ReactNode;
  };
  /** A second, flat picture (`S` swaps; the other sits in the corner). Absent = model only. */
  schematic?: (size: "main" | "inset", readout?: ReactNode) => ReactNode;
  /** The go-to popup; `jump` selects and flies to a subject with a landing. */
  goTo?: (jump: (key: SubjectKey) => void) => ReactNode;
  furniture?: { title?: ReactNode; actions?: ReactNode; legend?: ReactNode };
  /** Replaces the default issue pick (select its element and the issue). */
  onIssuePick?: (target: IssueTarget) => void;
  /** Told of every pick and clear, before the page moves. */
  onPick?: (key: SubjectKey | null) => void;
}

type DocRef = { session: string; openId: string };
type Move = { history: "push" | "replace" };
const CONTEXT_KEYS = ["context", "halo"];


/** The capture request a focus asks for; null when nothing is walked or near. */
export function captureRequest(
  focus: PictureContent["focus"],
  layers: readonly string[],
  radiusFt: number,
  representation: ContextRepresentation,
  maxTriangles = 3_000_000,
) {
  const ids = [...new Set([...focus.walked, ...focus.near].map(idOf))].filter((id) => id > 0);
  if (!ids.length) return null;
  return {
    ...sceneRequest(
      ids.sort((a, b) => a - b),
      !CONTEXT_KEYS.some((key) => layers.includes(key)),
      radiusFt,
      representation,
    ),
    // Whole-document exact focus exceeds 1.5M triangles on Project A. Never drop focus to fit.
    maxTriangles,
  };
}

/** Each element's smallest admitted group's leaves, from the declared members. */
export function hoverGroupsOf(members: Members, admits: (group: SubjectKey) => boolean) {
  const leaves = (key: SubjectKey, seen = new Set<SubjectKey>()): SubjectKey[] => {
    if (seen.has(key)) return [];
    seen.add(key);
    const children = members.get(key);
    return children ? children.flatMap((child) => leaves(child, seen)) : [key];
  };
  const best = new Map<SubjectKey, readonly SubjectKey[]>();
  for (const group of members.keys()) {
    if (!admits(group)) continue;
    const own = leaves(group);
    for (const leaf of own) if ((best.get(leaf)?.length ?? Infinity) > own.length) best.set(leaf, own);
  }
  return best;
}

const landPicture = (node: HTMLDivElement | null) => {
  if (node) land(node);
};
const NO_MEMBERS: Members = new Map();

export function Picture<L extends string>({
  selection,
  source,
  page,
  setPage,
  renderPane,
  content,
  onPose,
  jump,
}: {
  /** The page's derived selection atom: the one selection, registered here for the document. */
  selection: Atom.Atom<ReadonlySet<SubjectKey>>;
  /** `native` follows the snapshot revision; `doc` is the bound document that keeps retention;
   * `label` names what a retained read shows; `refreshing` holds the last read while re-reading. */
  source: { native: DocRef | null; doc: DocRef | null; version: string; label: string; refreshing: boolean };
  page: PicturePage<L>;
  setPage: (next: Partial<PicturePage<L>>, move?: Move) => void;
  renderPane: TeachingPaneRender;
  content: PictureContent<L>;
  /** Reports the committed renderer pose as derived facts; never writes Page. */
  onPose?: (pose: OrbitViewport | null) => void;
  /** Alias picks elsewhere call this when the subject is already the selection: fly again. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}) {
  const doc = useContext(AttentionDocument) ?? "";
  useAttentionDocument(doc, selection);
  useMembers(doc, content.members ?? NO_MEMBERS);
  const [contextRepresentation, setContextRepresentation] = useState<"boxes" | "meshes">("boxes");
  const { lit: attentionLit, selected: attentionSelected } = useElementAttention();
  // Reverse hover answers a hovered element only, never a row's expansion into elements.
  const over = useAtomValue(hoveredRef);
  const hoveredElement = over?.doc === doc && over.key.startsWith("e:") ? over.key : null;
  const hoveredIssue = useHoveredIssue();
  const onIssueHover = useIssueHover();
  const observation = useNativeObservation();
  const native = source.native;
  const request = useMemo(
    () =>
      captureRequest(
        content.focus,
        page.layers,
        page.contextRadiusFt,
        contextRepresentation,
        content.capture?.maxTriangles,
      ),
    [content.focus, page.layers, page.contextRadiusFt, contextRepresentation, content.capture?.maxTriangles],
  );
  const captured = useCapture(request, native, source.version, content.capture?.cuts);
  const fixture = content.capture?.meshes;
  const capture = fixture ? { ...captured, meshes: fixture, focusMeshes: fixture } : captured;
  // Capture provenance owns visual retention; the bound document remains its fallback
  // while pricing withdraws capture readiness. Neither grants native action authority.
  const pictureDocument = native ?? source.doc;
  const pictureKey =
    pictureDocument && request ? `${pictureDocument.session}/${pictureDocument.openId}` : null;
  const { read, holding } = usePictureRead(capture, pictureKey, source.label, source.refreshing);
  const bounds = usePictureBounds(read.meshes, content.lines);
  const [pictureHost, setPictureHost] = useState<HTMLDivElement | null>(null);
  const [pictureSize, setPictureSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!pictureHost) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setPictureSize((before) =>
        before?.width === width && before.height === height
          ? before
          : width > 0 && height > 0
            ? { width, height }
            : null,
      );
    });
    observer.observe(pictureHost);
    return () => observer.disconnect();
  }, [pictureHost]);
  const pose = useMemo(
    () => poseOf(page.viewport, bounds, pictureSize),
    [page.viewport, bounds, pictureSize],
  );
  const landing = useRef<(() => void) | null>(null);
  const pictureJump = useRef<((key: SubjectKey) => void) | null>(null);
  useEffect(() => {
    if (!jump) return;
    const callback = pictureJump.current;
    jump.current = callback;
    // The retained route owns selection state, not the disposed picture's geometry closure.
    return () => {
      if (jump.current === callback) jump.current = null;
    };
  });
  const orbit = useLiveOrbit(
    pose,
    stageViewport(setPage),
    `${pictureKey}/${page.picture}`,
    page.viewport,
    bounds?.scene,
    landing,
  );
  useEffect(() => {
    onPose?.(pose);
  }, [pose, onPose]);
  const layers = new Set<string>(page.layers);
  // Stable while the layers and the page's toggles hold, so the renderer's layers do too.
  const drawn = useMemo(
    () => (content.layers ?? []).filter((l) => !l.toggle || page.layers.includes(l.toggle as L)),
    [content.layers, page.layers],
  );
  const picture = page.picture;
  const swap = () =>
    setPage({ picture: picture === "model" ? "schematic" : "model" }, { history: "push" });

  // The page's element pick; a claim or a row selects through `issue` and its members.
  const pickedId = /^\d+$/.test(page.selected) ? Number(page.selected) : null;
  const pickedKey = pickedId == null ? null : elementKey(pickedId);
  const widen = content.widen;
  const selectionOf = (id: number) =>
    new Set([id, ...(widen?.(elementKey(id)) ?? []).map(idOf).filter(Number.isFinite)]);
  // Attention is the one selection; keyed on its members so a hover elsewhere redraws nothing.
  const selectedSig = [...attentionSelected].join();
  const selected = useMemo(
    () => (pickedId == null ? new Set(attentionSelected) : selectionOf(pickedId)),
    [selectedSig, pickedId, widen], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groupsOf = useMemo(
    () =>
      content.hoverGroups && content.members
        ? hoverGroupsOf(content.members, content.hoverGroups)
        : null,
    [content.members, content.hoverGroups],
  );
  const hoverGroup = hoveredElement ? (groupsOf?.get(hoveredElement) ?? null) : null;
  const lit = useMemo(
    () =>
      hoverGroup
        ? new Set([...attentionLit, ...hoverGroup.map(idOf).filter(Number.isFinite)])
        : attentionLit,
    [attentionLit, hoverGroup],
  );

  // Where a box in the world sits on screen now, from the live camera; null when off the picture.
  const onScreen = (b: Bounds | null): DOMRect | null => {
    const rect = pictureHost?.querySelector("[data-model-picture]")?.getBoundingClientRect();
    const now = orbit.read();
    const project = b && now && bounds && rect ? viewportProject(now, bounds.scene, rect) : null;
    return b && project && rect ? projectBounds(b, project, rect) : null;
  };
  const pick = (id: number | null) => {
    content.onPick?.(id == null ? null : elementKey(id));
    setPage({ selected: id == null ? "" : String(id), issue: "" }, { history: "push" });
  };
  // Escape and a click on empty picture both clear; neither pushes history when nothing is picked.
  const clearPick = () => {
    if (page.selected || page.issue) pick(null);
  };
  const pickIssue =
    content.onIssuePick ??
    ((target: IssueTarget) =>
      setPage({ selected: String(target.elementId), issue: target.key }, { history: "push" }));

  // A named alias jump writes selection and view together; its landing marks the subject.
  const [landed, setLanded] = useState<{ box: DOMRect | null; back: string; n: number } | null>(
    null,
  );
  const viewOf = (stage: ReturnType<typeof useStage>, ids: ReadonlySet<number>) =>
    picture === "model" ? stage.poseOf(boundsOfIds(read.meshes, content.lines, ids)) : null;
  const markLanding = (ids: ReadonlySet<number>, back: string) => () => {
    const host = pictureHost?.getBoundingClientRect();
    const box = onScreen(boundsOfIds(read.meshes, content.lines, ids));
    setLanded({
      back,
      n: performance.now(),
      box:
        box && host
          ? DOMRect.fromRect({
              x: box.x - host.left,
              y: box.y - host.top,
              width: box.width,
              height: box.height,
            })
          : null,
    });
  };
  const backWord = () =>
    pickedKey ? content.name(pickedKey) : "the previous view";
  const jumpTo = (stage: ReturnType<typeof useStage>, key: SubjectKey) => {
    const id = idOf(key);
    if (!Number.isFinite(id)) return;
    const ids = selectionOf(id);
    const view = viewOf(stage, ids);
    const same = String(id) === page.selected;
    setLanded(null);
    if (!view) return same ? undefined : setPage({ selected: String(id), issue: "" });
    landing.current = markLanding(ids, same ? "the previous view" : backWord());
    setPage(same ? { viewport: view } : { selected: String(id), issue: "", viewport: view }, {
      history: "push",
    });
  };

  const floaters = usePictureFloaters({
    picture,
    pose,
    bounds,
    lines: content.lines,
    meshes: read.meshes,
    orbit,
    lit,
    selected: attentionSelected,
    swap,
    small: content.schematic && (() => content.schematic!("inset")),
  });

  return (
    <PictureStage
      goTo={(stage) => content.goTo?.((key) => jumpTo(stage, key)) ?? null}
      {...{
        kind: "orbit",
        orbit,
        bounds,
        host: pictureHost,
        selectedBounds: boundsOfIds(read.meshes, content.lines, selected),
        clearSelection: clearPick,
        onHistoryStep: () => setLanded(null),
      }}
    >
      {(stage) => {
        pictureJump.current = (key) => jumpTo(stage, key);
        const goBack = () => stage.go("back");

        const readout = (
          <PictureReadout
            subject={content.readout.subject}
            title={pickedKey == null ? undefined : nameOrFallback(content.name(pickedKey))}
            pending={read.pending ? "refreshing" : undefined}
            retained={
              holding
                ? `showing ${holding.system}`
                : read.pending
                  ? "the last read stays drawn"
                  : undefined
            }
            summary={pickedKey != null ? undefined : content.readout.summary}
            onClear={pickedKey == null ? undefined : () => pick(null)}
            foot={
              landed ? (
                <Button
                  kind="nav"
                  direction="back"
                  label={`Back to ${landed.back}`}
                  reason={`Back to ${landed.back} · Alt+← or the mouse's back button`}
                  onClick={goBack}
                >
                  back to {landed.back}
                </Button>
              ) : null
            }
          >
            {pickedKey != null ? content.readout.facts?.(pickedKey) : content.readout.idle}
          </PictureReadout>
        );
        const model = (
          <ModelPicture
            sceneView={page.sceneView}
            paint={content.paint}
            contextMode={
              // Main's rule: neither context layer on = no context at all (the capture asks none).
              CONTEXT_KEYS.some((key) => layers.has(key)) ? page.contextStyle : "off"
            }
            kinds={content.kinds}
            colour={content.colour}
            contextRadiusFt={page.contextRadiusFt}
            contextRepresentation={contextRepresentation}
            onContextRepresentation={native ? setContextRepresentation : undefined}
            readout={readout}
            read={read}
            bounds={bounds}
            orbit={orbit}
            wheelHost={pictureHost?.closest<HTMLElement>("[data-slot='pane-field']")}
            layers={layers}
            selected={selected}
            lit={lit}
            drawn={drawn}
            overlay={content.overlay}
            hoveredIssue={hoveredIssue}
            onIssueHover={onIssueHover}
            onIssuePick={pickIssue}
            issue={page.issue}
            setPage={setPage}
            onPick={pick}
            onClear={clearPick}
          />
        );
        return renderPane(
          <>
            <div
              ref={setPictureHost}
              data-proto="E"
              data-picture=""
              aria-busy={read.pending || undefined}
              data-reading={read.pending ? "pending" : undefined}
              className="relative flex size-full min-h-0 flex-col"
              onPointerDownCapture={(e) => {
                // A gesture is the eye moving on: the landing marks and the way back go.
                if (landed && !(e.target as Element).closest("[data-picture-readout]"))
                  setLanded(null);
              }}
              onWheelCapture={(e) => {
                // A pending native read withholds element actions, not local camera movement.
                // The retained picture stays labelled; Scene3D separately gates picking.
                if (landed && !(e.target as Element).closest("[data-picture-readout]"))
                  setLanded(null);
              }}
            >
              {picture === "model" || !content.schematic ? model : content.schematic("main", readout)}

              {landed?.box ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    left: landed.box.x - 6,
                    top: landed.box.y - 6,
                    width: landed.box.width + 12,
                    height: landed.box.height + 12,
                  }}
                  key={landed.n}
                  ref={landPicture}
                />
              ) : null}
            </div>
          </>,
          {
            title: content.furniture?.title,
            actions: (
              <ButtonGroup>
                {pickedId != null ? (
                  <SelectionBoxButton target={observedElements(observation, [pickedId])} />
                ) : null}
                {stage.goTo}
                {content.furniture?.actions}
              </ButtonGroup>
            ),
            modes: content.schematic
              ? {
                  label: "picture",
                  value: picture,
                  onChange: (key) =>
                    setPage({ picture: key as typeof picture }, { history: "push" }),
                  // `S` sits on the other picture, so the one chord always swaps.
                  options: PICTURE_MODES.map((option) => ({
                    ...option,
                    chord: option.key === picture ? undefined : "S",
                  })),
                }
              : undefined,
            layers: {
              value: page.layers,
              options: content.layerOptions.map((option) => ({
                ...option,
                busy: CONTEXT_KEYS.includes(option.key) && read.pending,
              })),
              onToggle: (key) =>
                setPage(
                  {
                    layers: toggleLayer(
                      content.layerOptions.map((option) => option.key),
                      page.layers,
                      key as L,
                    ),
                  },
                  { history: "push" },
                ),
            },
            legend: content.furniture?.legend,
            floaters,
          },
        );
      }}
    </PictureStage>
  );
}
