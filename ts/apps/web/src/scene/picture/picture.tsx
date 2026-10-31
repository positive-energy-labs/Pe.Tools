/**
 * The one route-level picture. It owns every picture behaviour: capture with context, retention,
 * pose and orbit, stage verbs, selection and member registration on attention, hover (with the
 * reverse group expansion), globe, go-to, section, completeness, the readout and pane furniture.
 * A surface hands it content only and writes no other picture code. Content may change freely:
 * capture keys on the document and the focus, the camera on the document and the picture mode,
 * so neither remounts when a view or variant swaps its content.
 */
import type * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  AttentionDocument,
  elementKey,
  hovered as hoveredRef,
  setHovered,
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
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { toggleLayer, type PicturePage } from "@pe/agent-contracts";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { useElementAttention, useHoveredIssue, useIssueHover } from "#/attention";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements, useNativeObservation } from "#/revit/observation";
import { alarmLayers } from "#/scene/damage";
import { sceneRequest, type ContextRepresentation } from "#/scene/host";
import type { OrbitViewport } from "#/scene/orbit";
import { viewportProject } from "#/scene/projection";
import type { ColourMode } from "#/scene/renderer";
import { PictureStage, projectBounds, stageViewport, useStage } from "#/scene/stage-controller";
import { pictureModes } from "#/scene/stage-teaching";
import { strandLayers } from "#/scene/strands";
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
  type PictureStrand,
} from "./model";
import { useCapture, usePictureRead } from "./read";
import { strandFixture, strandFixtureOn } from "./strand-fixture";

export { idOf, type PictureLayer, type PictureLine, type PictureOverlayFrame, type PictureStrand };

/** Everything a surface says about its picture. Numeric ids stop at the renderer adapter. */
export interface PictureContent<L extends string = string, F extends string = string> {
  /** What is captured: `walked` draws as ink, `near` joins the capture as stubs. Never implies reach. */
  focus: { walked: readonly SubjectKey[]; near: readonly SubjectKey[] };
  /** Group subjects (issue:, run:, leg:, system:) to their element keys; the core registers them. */
  members?: Members;
  /** Reverse hover: a hovered element also lights the smallest declared group this admits.
   * Absent = the single element. */
  hoverGroups?: (group: SubjectKey) => boolean;
  /** A picked element's selection, widened (E: its leg). Absent = the single element. */
  widen?: (key: SubjectKey) => readonly SubjectKey[];
  /** Capture limits and clipping; `meshes` substitutes a dev fixture for the capture. */
  capture?: { maxTriangles?: number; cuts?: SceneMeshes["cuts"]; meshes?: SceneMeshes | null };
  /** Centrelines: bounds before meshes arrive, the jump fallback, and the globe's lines. */
  lines: readonly PictureLine[];
  /** Ordered paths drawn over the centrelines, side by side where they share an element. The
   * heavy strand and any lit or selected strand animate their flow; the rest hold still. */
  strands?: readonly PictureStrand[];
  /** Subjects over a limit: the only alarm ink (look rule 2026-10-26). Absent = nothing alarms. */
  over?: ReadonlySet<SubjectKey>;
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
  /** A second, flat picture (a schematic, a plan): its key is the page's `picture` value; `S`
   * swaps it with the model and the other sits in the corner. Absent = model only. */
  flat?: {
    key: F;
    label: string;
    says?: string;
    render: (size: "main" | "inset", readout?: ReactNode) => ReactNode;
  };
  /** The go-to popup; `jump` selects and flies to a subject with a landing. */
  goTo?: (jump: (key: SubjectKey) => void) => ReactNode;
  furniture?: { title?: ReactNode; actions?: ReactNode; legend?: ReactNode };
  /** Replaces the default issue pick (select its element and the issue). */
  onIssuePick?: (target: IssueTarget) => void;
  /** Told of every pick and clear, before the page moves. */
  onPick?: (key: SubjectKey | null) => void;
}

/** How context is drawn; `none` is the focus read's own and never a choice here. */
export type PictureContext = Exclude<ContextRepresentation, "none">;
/** Interim, disclosed default pending kaitpw's IFC drawing ruling (docs/features/spatial/MAP.md
 * Owed): link-frame envelopes are oriented and containing at link-box cost; meshes cost about
 * +5 GiB on Chadds SA 7, against the never-restart goal. The one place the default lives. */
export const CONTEXT_DEFAULT: PictureContext = "link-boxes";

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

/** A subject's leaves through the declared members: transitive, cycle-bounded; an undeclared key
 * is its own leaf (attention's `expand`, over a plain map). */
export function leavesOf(members: Members, key: SubjectKey, seen = new Set<SubjectKey>()) {
  if (seen.has(key)) return [];
  seen.add(key);
  const children = members.get(key);
  return children
    ? children.flatMap((child): SubjectKey[] => leavesOf(members, child, seen))
    : [key];
}

/** Each element's smallest admitted group's leaves, from the declared members. */
export function hoverGroupsOf(members: Members, admits: (group: SubjectKey) => boolean) {
  const best = new Map<SubjectKey, readonly SubjectKey[]>();
  for (const group of members.keys()) {
    if (!admits(group)) continue;
    const own = leavesOf(members, group);
    for (const leaf of own)
      if ((best.get(leaf)?.length ?? Infinity) > own.length) best.set(leaf, own);
  }
  return best;
}

/** The declared members plus each strand's path, unless the surface already declared the strand. */
export function membersWithStrands(members: Members, strands: readonly PictureStrand[]): Members {
  const missing = strands.filter((strand) => !members.has(strand.key));
  return missing.length
    ? new Map([...members, ...missing.map((strand) => [strand.key, strand.path] as const)])
    : members;
}

/** What a mark pick writes to the page: a subject mark (a strand) selects its own key; an issue
 * mark selects its element and the issue. */
export const markPick = (target: IssueTarget) =>
  target.subject
    ? { selected: target.key, issue: "" }
    : { selected: String(target.elementId), issue: target.key };

/** What a jump to `key` selects and frames. An element frames itself, not the section a pick
 * widens it to (a footnote names the element); a group (a run, an issue, a path) selects itself
 * and frames its element leaves. */
export function jumpSubject(key: SubjectKey, members: Members) {
  const id = idOf(key);
  if (Number.isFinite(id) && id > 0) return { selected: String(id), ids: new Set([id]) };
  const ids = leavesOf(members, key).map(idOf);
  return { selected: key as string, ids: new Set(ids.filter((n) => Number.isFinite(n) && n > 0)) };
}

const landPicture = (node: HTMLDivElement | null) => {
  if (node) land(node);
};
const NO_MEMBERS: Members = new Map();
const NO_STRANDS: readonly PictureStrand[] = [];

export function Picture<L extends string, F extends string>({
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
  source: {
    native: DocRef | null;
    doc: DocRef | null;
    version: string;
    label: string;
    refreshing: boolean;
  };
  page: PicturePage<L, F>;
  setPage: (next: Partial<PicturePage<L, F>>, move?: Move) => void;
  renderPane: TeachingPaneRender;
  content: PictureContent<L, F>;
  /** Reports the committed renderer pose as derived facts; never writes Page. */
  onPose?: (pose: OrbitViewport | null) => void;
  /** Alias picks elsewhere call this when the subject is already the selection: fly again. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}) {
  // No document = selection and member registration silently do nothing (the fan sheet's 10-28
  // defect), so a Picture outside an `AttentionRoot` fails loudly instead.
  const doc = useContext(AttentionDocument);
  if (!doc) throw new Error("Picture requires an AttentionRoot (attention document)");
  useAttentionDocument(doc, selection);
  const registry = useContext(RegistryContext);
  const selectedKeys = useAtomValue(selection);
  const [contextRepresentation, setContextRepresentation] = useState(CONTEXT_DEFAULT);
  const { lit: attentionLit, selected: attentionSelected } = useElementAttention();
  // Reverse hover answers a hovered element only, never a row's expansion into elements.
  const over = useAtomValue(hoveredRef);
  const hoveredElement = over?.doc === doc && over.key.startsWith("e:") ? over.key : null;
  const hoveredIssue = useHoveredIssue();
  const onIssueHover = useIssueHover();
  const observation = useNativeObservation();
  const native = source.native;
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
  const request = useMemo(
    () =>
      captureRequest(
        content.focus,
        page.layers,
        page.contextRadiusFt,
        contextRepresentation,
        content.capture?.maxTriangles,
      ),
    [
      content.focus,
      page.layers,
      page.contextRadiusFt,
      contextRepresentation,
      content.capture?.maxTriangles,
    ],
  );
  const captured = useCapture(
    pictureSize ? request : null,
    native,
    source.version,
    content.capture?.cuts,
  );
  const fixture = content.capture?.meshes;
  const capture = fixture ? { ...captured, meshes: fixture, focusMeshes: fixture } : captured;
  // Capture provenance owns visual retention; the bound document remains its fallback
  // while pricing withdraws capture readiness. Neither grants native action authority.
  const pictureDocument = native ?? source.doc;
  const pictureKey =
    pictureDocument && request ? `${pictureDocument.session}/${pictureDocument.openId}` : null;
  const { read, holding } = usePictureRead(capture, pictureKey, source.label, source.refreshing);
  const bounds = usePictureBounds(read.meshes, content.lines);
  // Dev only: `?strands=fixture` draws strands from the content's centrelines (else the meshes').
  const devStrands = useMemo(
    () =>
      !content.strands && strandFixtureOn() ? strandFixture(content.lines, read.meshes) : null,
    [content.strands, content.lines, read.meshes],
  );
  const strands = content.strands ?? devStrands?.strands ?? NO_STRANDS;
  const strandLines = devStrands?.lines ?? content.lines;
  const overSubjects = content.over ?? devStrands?.over;
  const members = useMemo(
    () => membersWithStrands(content.members ?? NO_MEMBERS, strands),
    [content.members, strands],
  );
  useMembers(doc, members);
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
  // Strands and over paint are the core's own layer: always drawn while the content gives them.
  const overKeys = useMemo(
    () =>
      new Set(
        [...(overSubjects ?? [])]
          .flatMap((key) => leavesOf(members, key))
          .filter((key) => key.startsWith("e:")),
      ),
    [overSubjects, members],
  );
  const coreLayer = useMemo<PictureLayer | null>(() => {
    const built = strandLayers(strands, strandLines, overKeys);
    const overIds = new Set([...overKeys].map(idOf));
    return built.length || overIds.size
      ? {
          key: "strands",
          draw: ({ meshes }) => [...built, ...(meshes ? alarmLayers(meshes, overIds) : [])],
        }
      : null;
  }, [strands, strandLines, overKeys]);
  const drawn = useMemo(
    () => [
      ...(coreLayer ? [coreLayer] : []),
      ...(content.layers ?? []).filter((l) => !l.toggle || page.layers.includes(l.toggle as L)),
    ],
    [coreLayer, content.layers, page.layers],
  );
  // A strand lit (its subject hovered here or on a row) or selected flows: the renderer reads it
  // through the same hover and focus rungs an issue mark takes.
  const hoveredStrand =
    over?.doc === doc && strands.some((strand) => strand.key === over.key) ? over.key : null;
  const selectedStrand = strands.find((strand) => selectedKeys.has(strand.key))?.key ?? "";
  const picture = page.picture;
  const flat = content.flat;
  const swap = () =>
    setPage({ picture: picture === "model" && flat ? flat.key : "model" }, { history: "push" });

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
    setAbsent(null);
    content.onPick?.(id == null ? null : elementKey(id));
    setPage({ selected: id == null ? "" : String(id), issue: "" }, { history: "push" });
  };
  // Escape and a click on empty picture both clear; neither pushes history when nothing is picked.
  const clearPick = () => {
    if (page.selected || page.issue) pick(null);
  };
  const pickIssue =
    content.onIssuePick ??
    ((target: IssueTarget) => setPage(markPick(target), { history: "push" }));
  const pickMark = (target: IssueTarget) => {
    if (!target.subject) return pickIssue(target);
    content.onPick?.(target.key as SubjectKey);
    setPage(markPick(target), { history: "push" });
  };
  // A subject mark lights its own key; an issue mark lights `issue:<key>` (useIssueHover).
  const hoverMark = (target: IssueTarget | null) =>
    target?.subject
      ? setHovered(registry, { doc, key: target.key as SubjectKey })
      : onIssueHover(target?.key ?? null);

  // A named alias jump writes selection and view together; its landing marks the subject.
  const [landed, setLanded] = useState<{ box: DOMRect | null; back: string; n: number } | null>(
    null,
  );
  // A jump whose subject has neither meshes nor a centreline here says so instead of doing nothing.
  const [absent, setAbsent] = useState<string | null>(null);
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
  const backWord = () => (pickedKey ? content.name(pickedKey) : "the previous view");
  const jumpTo = (stage: ReturnType<typeof useStage>, key: SubjectKey) => {
    const { selected: next, ids } = jumpSubject(key, members);
    const same = next === page.selected;
    const box = ids.size ? boundsOfIds(read.meshes, content.lines, ids) : null;
    setLanded(null);
    setAbsent(
      picture === "model" && !box
        ? `${Number.isFinite(idOf(key)) ? idOf(key) : key} is not in this picture`
        : null,
    );
    const view = picture === "model" && box ? stage.poseOf(box) : null;
    if (!view)
      return same ? undefined : setPage({ selected: next, issue: "" }, { history: "push" });
    landing.current = markLanding(ids, same ? "the previous view" : backWord());
    setPage(same ? { viewport: view } : { selected: next, issue: "", viewport: view }, {
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
    flat: flat && { key: flat.key, label: flat.label, small: () => flat.render("inset") },
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
        onHistoryStep: () => {
          setLanded(null);
          setAbsent(null);
        },
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
            capturing={capture.pending}
            bounds={bounds}
            orbit={orbit}
            wheelHost={pictureHost?.closest<HTMLElement>("[data-slot='pane-field']")}
            layers={layers}
            selected={selected}
            lit={lit}
            drawn={drawn}
            overlay={content.overlay}
            hoveredIssue={hoveredIssue ?? hoveredStrand}
            onIssueHover={hoverMark}
            onIssuePick={pickMark}
            issue={page.issue || selectedStrand}
            setPage={setPage}
            onPick={pick}
            onClear={clearPick}
          />
        );
        return renderPane(
          <>
            <div
              ref={setPictureHost}
              // Exception to "the core names no surface": tests/e2e/route-chaos.test.ts still selects
              // E's picture by `data-proto="E"`. Move that test to `data-picture`, then drop this.
              data-proto="E"
              data-picture=""
              aria-busy={read.pending || undefined}
              data-reading={read.pending ? "pending" : undefined}
              className="relative flex size-full min-h-0 flex-col"
              onPointerDownCapture={(e) => {
                // A gesture is the eye moving on: the landing marks and the way back go.
                if (!(e.target as Element).closest("[data-picture-readout]")) {
                  if (landed) setLanded(null);
                  if (absent) setAbsent(null);
                }
              }}
              onWheelCapture={(e) => {
                // A pending native read withholds element actions, not local camera movement.
                // The retained picture stays labelled; Scene3D separately gates picking.
                if (landed && !(e.target as Element).closest("[data-picture-readout]"))
                  setLanded(null);
              }}
            >
              {picture === "model" || !flat ? model : flat.render("main", readout)}

              {absent ? (
                // The readout is a floater that may sit collapsed: the answer stands on the picture,
                // where ModelPicture's own pick refusals stand.
                <div data-picture-absent="" className="pointer-events-none absolute top-1 left-2">
                  <OutcomeLine kind="advisory" label={absent} />
                </div>
              ) : null}
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
            modes: flat
              ? {
                  label: "picture",
                  value: picture,
                  onChange: (key) =>
                    setPage({ picture: key as typeof picture }, { history: "push" }),
                  // `S` sits on the other picture, so the one chord always swaps.
                  options: pictureModes(flat).map((option) => ({
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
