/**
 * The picture pane: one `Pane` whose strip holds the picture mode (model or schematic, `S` swaps),
 * the layers, and two floaters, the orbit globe (`G`) and the other picture small (a click swaps).
 * The model is the subject system's real meshes (`model-picture.tsx`) with its annotations; the
 * schematic is the one-line. The readout docked top-left (`readout.tsx`) says what is selected: an
 * element's facts and issues, or a ruling's verdicts, never a popover over the picture. A pick, a
 * frame, a look and a gesture each write only their own Page keys.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { flushSync } from "react-dom";

import { DUCTS_LAYERS, emptyListSearch, toggleLayer } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { ChevronRight } from "lucide-react";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements } from "#/revit/observation";
import { KeyLegend } from "#/components/lang/kbd";
import { Pane } from "#/components/lang/pane";
import { useNativeObservation } from "#/revit/observation";
import { useScene } from "#/scene/use-scene";
import { flyTo, useLiveOrbit } from "#/scene/live-orbit";
import type { Bounds } from "#/scene/types";
import { useSurfaceHost } from "#/navigation/surface-host";
import { Button } from "@pe/kit/lang/button";
import { useScopeKeys } from "@pe/kit/keys";
import { viewportProject } from "#/scene/projection";

import type { Ruling } from "../../annotations";
import { elementNamer } from "../../claims";
import { PICTURE_KEYS } from "../../docs";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { sceneRequestOf } from "../../manifest";
import { findingLayers, findingShapes, noRunLayers } from "../../finding-layers";
import {
  boundsOfIds,
  clearPose,
  ModelPicture,
  poseOf,
  subjectPose,
  usePictureBounds,
} from "../../model-picture";
import { GoToSubject } from "./go-to";
import { PictureReadout } from "./readout";
import { RunDetail, runOf } from "./run-detail";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { ProvisionalNote } from "../../provisional";
import { indexOf, sceneOf, subjectScene } from "../../scene";
import { Schematic } from "../../schematic";
import { EncodingPicker } from "../encoding/picker";
import { ScaleLegend } from "../encoding/scale-legend";
import type { GroupEncoding } from "../encoding/use-encoding";
import type { ProtoProps } from "../props";
import { BarPopover, fmtFt, SystemMark, systemIssues } from "./bar";
import type { Split, systemList } from "../b/model";
import type { StageIssue } from "../../inbox-rows";
import { damageLayer } from "#/scene/damage";
import { LAND, LAND_EASING } from "#/scene/marks";
import { usePictureFloaters } from "./picture-floaters";
import { RulingBody, useMarks } from "./rulings";
import { noRunParts } from "../../subject-text";
import { SubjectText, SubjectTextContext } from "../../subject-text-view";

const LAYER_WORDS: Record<
  (typeof DUCTS_LAYERS)[number],
  { label: string; chord?: "M" | "C" | "L" }
> = {
  meshes: { label: "meshes", chord: "M" },
  context: { label: "context", chord: "C" },
  centrelines: { label: "centrelines", chord: "L" },
  "no-run": { label: "branches with no run" },
  labels: { label: "labels" },
  findings: { label: "findings" },
};
const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

/** The system a switch is opening ("" = every system) while the held screen still draws the last. */
export const OpeningContext = createContext<string | null>(null);

/** The plate's transitional line: the only thing a switch repaints before the new system renders. */
function OpeningNote() {
  const opening = useContext(OpeningContext);
  if (opening == null) return null;
  return (
    <span className="truncate text-ink-2" data-e-opening={opening}>
      {opening ? `opening ${opening}…` : "opening every system…"}
    </span>
  );
}

export interface ECanvasExtra {
  issues: readonly StageIssue[];
  hoveredIssue: string | null;
  onIssueHover: (key: string | null) => void;
  /** The element set a sidebar row lights; empty lights nothing. */
  lit: ReadonlySet<number>;
  /** The element under the pointer, here or in a pane (the screen's reach store). */
  hovered: number | null;
  onHover: (id: number | null) => void;
  /** The system's groups (stable, `systemScope`); the picture draws every one. */
  groups: readonly string[];
  /** The group whose fan the header reads: the system's largest; the schematic draws it. */
  lead: string;
  /** The system's issue ids; null = every issue on a drawn element. */
  issueScope: ReadonlySet<string> | null;
  /** The finding (and issue) ids the picture annotates (`annotatedFindings`). */
  annotated: ReadonlySet<string>;
  /** The group's encoding: the screen owns it so the tree reads the same numbers. */
  scale: GroupEncoding;
  /** An element's name the way the sidebar reads it (grille labels first). */
  nameOf: (id: number) => string;
  /** What the picture is of at a glance: the chosen system's row (identity and state) or the
   * document's census, the system a switch is opening, and whether the read is refreshing. */
  identity: {
    system: (ReturnType<typeof systemList>[number] & { needsFix: boolean }) | null;
    census: { systems: number; priced: number; fix: number };
    refreshing: boolean;
    /** Opens the system's tree, where its issues stand. */
    open: () => void;
    /** The critical run's loss groups under the ESP, with the system's fans at its head. */
    breakdown: { split: Split; scale: number; fans: () => ReactNode } | null;
    /** The title's root crumb: back to every system. */
    allSystems: () => void;
  };
  /** The screen's alias picks call this when the subject is already the selection: fly again. */
  jump?: RefObject<((id: number) => void) | null>;
}

/** The landing mark: drawn once per landing (keyed), scales in and fades while the camera is still. */
// The alias-jump landing lands like every stage mark (`scene/marks.ts`): one ease and length, at
// the selection outline's weight, then fades so the silhouette selection carries on.
const flash = (node: HTMLDivElement | null) => {
  node?.animate(
    [
      { opacity: 1, transform: "scale(1.35)", easing: LAND_EASING },
      { opacity: 1, transform: "scale(1)", offset: 0.6 },
      { opacity: 0, transform: "scale(1)" },
    ],
    { duration: (LAND * 1000) / 0.6, fill: "forwards" },
  );
};

export function ECanvas(props: ProtoProps & ECanvasExtra) {
  const { snapshot } = props;
  if (!snapshot)
    return (
      <p className="p-3 text-ink-2">
        {props.empty?.says ?? (props.reading.pending ? "reading ducts…" : "no snapshot")}
      </p>
    );
  return <Canvas {...props} snapshot={snapshot} />;
}

function Canvas({
  snapshot,
  priced,
  page,
  subject,
  claims,
  onVerdict,
  work,
  hovered,
  onHover,
  lit,
  issueScope,
  annotated,
  issues,
  hoveredIssue,
  onIssueHover,
  groups,
  lead,
  scale,
  nameOf,
  identity,
  jump,
  setPage,
  onSelect,
  onPose,
}: ProtoProps & ECanvasExtra & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
  const observation = useNativeObservation();
  const index = useMemo(() => indexOf(snapshot, priced), [snapshot, priced]);
  const labelOf = useMemo(() => labelOfNode(snapshot), [snapshot]);
  const scene = useMemo(
    () =>
      subject
        ? subjectScene(
            index,
            subject.ids,
            legsOf(snapshot, subject.ids, labelOf, subject.work ?? null),
          )
        : sceneOf(index, groups, () => true),
    [index, snapshot, subject, labelOf, groups],
  );
  const native = observation.scope?.source === "native" ? observation.scope.document : null;
  const request = useMemo(
    () => sceneRequestOf(snapshot, page, groups),
    [snapshot, page.system, page.layers, groups],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const read = useScene(request, native, page.epoch);
  const bounds = usePictureBounds(read.meshes, scene);
  const committedPose = useMemo(() => poseOf(page.viewport, bounds), [page.viewport, bounds]);
  const pose = committedPose;
  // Marks the landing of the next flight `useLiveOrbit` makes to a Page pose (an alias jump).
  const landing = useRef<(() => void) | null>(null);
  const orbit = useLiveOrbit(
    committedPose,
    (viewport, how) => setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" }),
    `${native?.session}/${native?.openId}/${page.system}/${page.picture}`,
    page.viewport,
    bounds?.scene,
    landing,
  );
  // Pea reads the committed pose (`facts.pose`), not the in-progress globe preview.
  useEffect(() => {
    onPose?.(committedPose);
  }, [committedPose, onPose]);
  const layers = new Set<string>(page.layers);
  const picture = page.picture;
  const swap = () =>
    setPage({ picture: picture === "model" ? "schematic" : "model" }, { history: "push" });

  const sub = scene.subject ?? null;
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const pointer = useRef({ x: 0, y: 0 });
  const [pictureHost, setPictureHost] = useState<HTMLDivElement | null>(null);
  // A pick shows in the readout at once; the route hears of it after that paint (below).
  const [shown, setShown] = useState<number | null>(null);
  const [openRuling, setOpenRuling] = useState<number | null>(null);
  const selectionPublish = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSelection = useRef<number | null>(null);
  useEffect(() => () => clearTimeout(selectionPublish.current), []);
  useEffect(() => {
    // Page's Escape cannot see a pick waiting for its first paint. Cancel it at the event boundary
    // so a fast Escape, including one before the popup mounts, cannot resurrect selection later.
    const escapePending = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pendingSelection.current === null) return;
      clearTimeout(selectionPublish.current);
      pendingSelection.current = null;
      setShown(null);
      setPage({ selected: "" }, { history: "push" });
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", escapePending, true);
    return () => document.removeEventListener("keydown", escapePending, true);
  }, [setPage]);
  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const { rulings, labels, cumulative } = useMarks({
    snapshot,
    priced,
    scene,
    claims,
    work,
    issueScope,
    annotated,
    pointOf,
  });

  const noRuns = useMemo<ReturnType<typeof noRunBranches>>(
    () =>
      priced && page.system
        ? noRunBranches(
            priced.snapshot,
            priced.next,
            systemScope(priced.snapshot, page.system),
            priced.flows,
          )
        : new Map(),
    [priced, page.system],
  );
  const findings3d = useMemo(
    () =>
      findingLayers(
        findingShapes(
          snapshot,
          annotated,
          work.doc,
          page.system ? systemScope(snapshot, page.system).members : undefined,
        ),
        issues,
      ),
    [snapshot, annotated, work.doc, page.system, issues],
  );

  const damage = useMemo(
    () =>
      read.meshes
        ? read.meshes.instances.flatMap((instance) => {
            if (
              !instance.vertexCount ||
              instance.revitId == null ||
              instance.linkInstanceId != null
            )
              return [];
            const blockers = issues
              .filter((issue) => issue.blocking && issue.ids.includes(instance.revitId!))
              .sort(
                (a, b) =>
                  a.ids.length - b.ids.length ||
                  Number(a.key === "airflow" || a.key === "unit-airflow") -
                    Number(b.key === "airflow" || b.key === "unit-airflow"),
              );
            return blockers.length
              ? [
                  damageLayer(
                    read.meshes!,
                    instance,
                    blockers.map((issue) => ({ key: issue.key, elementId: instance.revitId! })),
                    blockers.flatMap((issue) => issue.findings),
                  ),
                ]
              : [];
          })
        : [],
    [read.meshes, issues],
  );
  // Each stage mark answers its own picture layer: no-runs to `no-run`, findings and damage to `findings`.
  const noRunsOn = page.layers.includes("no-run");
  const findingsOn = page.layers.includes("findings");
  const noRuns3d = useMemo(
    () => (noRunsOn ? noRunLayers(noRuns, snapshot, issues) : []),
    [noRunsOn, noRuns, snapshot, issues],
  );
  const stageLayers = useMemo(
    () => [...noRuns3d, ...(findingsOn ? [...findings3d, ...damage] : [])],
    [noRuns3d, findingsOn, findings3d, damage],
  );
  const covered = useMemo(
    () => new Set(stageLayers.flatMap((layer) => layer.findings ?? [])),
    [stageLayers],
  );
  const marks = rulings.filter(
    (r) =>
      !read.meshes ||
      !covered.has(
        r.kind === "claim"
          ? `claim:${r.claim.id}`
          : r.kind === "inferred"
            ? r.finding.id
            : r.issue.id,
      ),
  );

  // Header facts: a system name (never a group id), Pe fan static, critical run total.
  const firstId = subject?.ids[0] ?? scene.segments[0]?.segment.id ?? null;
  const systemName =
    (page.system || null) ??
    (firstId == null
      ? null
      : (byId.segments.get(firstId)?.systemName ?? byId.nodes.get(firstId)?.systemName)) ??
    null;
  const groupId =
    lead ||
    (firstId == null
      ? ""
      : (byId.segments.get(firstId)?.groupId ?? byId.nodes.get(firstId)?.groupId ?? ""));
  const solved = groupId ? priced?.next.byGroup[groupId] : null;
  const criticalName = solved?.critical != null ? nameOf(solved.critical) : null;
  const scopeTerminals = page.system ? systemScope(snapshot, page.system).terminals : null;
  const terminals = scopeTerminals?.size ?? 0;
  const flowless = useMemo(
    () =>
      scopeTerminals
        ? issues
            .flatMap((i) => i.findings)
            .flatMap((f) => (f.startsWith("flow:no-flow:") ? [Number(f.slice(13))] : []))
            .filter((t, k, all) => scopeTerminals.has(t) && all.indexOf(t) === k)
        : [],
    [issues, scopeTerminals],
  );

  const selected = useMemo(() => {
    const id =
      page.selected && !claims.some((c) => c.id === page.selected) ? Number(page.selected) : null;
    if (id == null || !Number.isFinite(id)) return new Set<number>();
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  }, [page.selected, claims, sub]);
  const litAll = useMemo(
    () => new Set([...lit, ...(hovered == null ? [] : [hovered])]),
    [lit, hovered],
  );

  // Where a box in the world sits on screen now, from the live camera; null when off the picture.
  const onScreen = (b: Bounds | null): DOMRect | null => {
    const rect = pictureHost?.querySelector("[data-model-picture]")?.getBoundingClientRect();
    const now = orbit.read();
    const project = b && now && bounds && rect ? viewportProject(now, bounds.scene, rect) : null;
    const points =
      b && project
        ? [b.minX, b.maxX].flatMap((x) =>
            [b.minY, b.maxY].flatMap((y) =>
              [b.minZ, b.maxZ].flatMap((z) => {
                const p = project([x, y, z]);
                return p ? [p] : [];
              }),
            ),
          )
        : [];
    const xs = points.map((p) => p[0] + rect!.left);
    const ys = points.map((p) => p[1] + rect!.top);
    return points.length
      ? DOMRect.fromRect({
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        })
      : null;
  };
  // A pick made on the picture (an element, a pin, an issue, the schematic) keeps the camera
  // still (kaitpw 2026-10-23); `quiet` tells the alias flight below that this selection is one.
  const quiet = useRef<{ id: string; at: number } | null>(null);
  const hush = (id: string) => (quiet.current = { id, at: performance.now() });
  // Showing the pick is local and urgent. Updating the address also renders the tree and rules;
  // let that work follow the readout's first paint. Two RAFs can run only 3 ms apart in headless
  // Chrome, before a visible paint, so the publish waits a frame and then 50 ms.
  const pick = (id: number | null) => {
    clearTimeout(selectionPublish.current);
    pendingSelection.current = id;
    setShown(id);
    setOpenRuling(null);
    if (id == null) return setPage({ selected: "" }, { history: "push" });
    hush(String(id));
    requestAnimationFrame(() => {
      if (pendingSelection.current !== id) return;
      selectionPublish.current = setTimeout(() => {
        if (pendingSelection.current !== id) return;
        pendingSelection.current = null;
        setPage({ selected: String(id) }, { history: "push" });
      }, 50);
    });
  };
  useEffect(() => {
    if (pendingSelection.current === null) setShown(null);
    if (!page.selected) setOpenRuling(null);
  }, [page.selected]);

  // Every other way a subject becomes the selection (a footnote, an inbox, tree or rules row, a
  // search result) is an alias jump: ONE Page write of the subject and the view that shows it with
  // its neighbours, so the route renders once, as it does for any selection. The camera travels
  // there the way Back and Forward travel (`useLiveOrbit`); the landing outlines the subject and
  // offers the way back, and Back is one step to where the eye was.
  const [landed, setLanded] = useState<{ box: DOMRect | null; back: string; n: number } | null>(
    null,
  );
  const aimed = useRef<{ selected: string; view: string } | null>(null);
  const selectionOf = (id: number) => {
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  };
  const viewOf = (ids: ReadonlySet<number>) => {
    const target = bounds && picture === "model" ? boundsOfIds(read.meshes, scene, ids) : null;
    if (!bounds || !target) return null;
    const view = subjectPose(bounds, target, orbit.read());
    const at = pictureHost?.querySelector("[data-model-picture]");
    return at ? clearPose(view, target, bounds.scene, at) : view;
  };
  const markLanding = (ids: ReadonlySet<number>, back: string) => () => {
    const host = pictureHost?.getBoundingClientRect();
    const box = onScreen(boundsOfIds(read.meshes, scene, ids));
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
    /^\d+$/.test(page.selected) ? nameOf(Number(page.selected)) : "the previous view";
  const jumpTo = (id: number) => {
    const ids = selectionOf(id);
    const view = viewOf(ids);
    const same = String(id) === page.selected;
    setLanded(null);
    if (!view) return same ? undefined : onSelect(id);
    aimed.current = { selected: String(id), view: JSON.stringify(view) };
    landing.current = markLanding(ids, same ? "the previous view" : backWord());
    setPage(same ? { viewport: view } : { selected: String(id), issue: "", viewport: view }, {
      history: "push",
    });
  };
  if (jump) jump.current = jumpTo;
  // A flight of our own (history null, Page already moved) for a selection that arrived without its
  // view: Pea, a cell in another system. Its landing replaces that selection's history entry.
  const flyToIds = (ids: ReadonlySet<number>, back: string) => {
    const view = viewOf(ids);
    if (!view || !bounds) return;
    flyTo(orbit, view, {
      history: "replace",
      scene: bounds.scene,
      onLand: markLanding(ids, back),
    });
  };
  const seen = useRef({ selected: page.selected, viewport: page.viewport, system: page.system });
  // A jump into another system waits for that system's picture to finish reading: a pose
  // committed against the centrelines would be re-read against the meshes' bounds.
  const owed = useRef<string | null>(null);
  useEffect(() => {
    const was = seen.current;
    seen.current = { selected: page.selected, viewport: page.viewport, system: page.system };
    const mine = aimed.current;
    aimed.current = null;
    if (mine && mine.selected === page.selected && mine.view === JSON.stringify(page.viewport))
      return; // our own jump: `useLiveOrbit` is flying it and `landing` marks it
    if (mine) landing.current = null;
    if (page.selected === was.selected) return;
    const own = quiet.current;
    quiet.current = null;
    owed.current = null;
    setLanded(null);
    if (!page.selected) return;
    if (own?.id === page.selected && performance.now() - own.at < 2000) return;
    const crossed = page.system !== was.system && page.viewport === null;
    if (!crossed && page.viewport !== was.viewport) return;
    const from = /^\d+$/.test(was.selected) ? nameOf(Number(was.selected)) : null;
    if (crossed) owed.current = from ?? (was.system || "all systems");
    else flyToIds(selected, from ?? "the previous view");
  }, [page.selected, page.viewport, page.system]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (owed.current === null || read.pending) return;
    const back = owed.current;
    owed.current = null;
    flyToIds(selected, back);
  }, [read.pending, read.meshes, scene]); // eslint-disable-line react-hooks/exhaustive-deps
  const router = useRouter();
  const surface = useSurfaceHost();
  const go = (way: "back" | "forward") => {
    setLanded(null);
    if (surface.native) surface.navigateNativeHistory(way);
    else router.history[way]();
  };
  const goBack = () => go("back");
  // View history is the page's history: every jump and named move pushes, a gesture replaces.
  // Bound here as well as by the browser so the native shell and a headless one step the same
  // history, once (the default is prevented).
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    [
      {
        hotkey: "Alt+ArrowLeft",
        label: "back",
        says: "Back to the previous selection and view; the camera travels there",
        callback: goBack,
        options: { conflictBehavior: "allow" },
      },
      {
        hotkey: "Alt+ArrowRight",
        label: "forward",
        says: "Forward again to the next selection and view",
        callback: () => go("forward"),
        options: { conflictBehavior: "allow" },
      },
    ],
    body,
  );

  const ruling = (r: Ruling) => {
    clearTimeout(selectionPublish.current);
    pendingSelection.current = null;
    hush(String(r.at));
    setShown(null);
    const finding =
      r.kind === "claim" ? `claim:${r.claim.id}` : r.kind === "issue" ? r.issue.id : r.finding.id;
    const issue = issues.find((i) => i.findings.includes(finding))?.key ?? finding;
    setPage({ selected: String(r.at), issue, rulingSearch: emptyListSearch() }, { history: "push" });
    setOpenRuling(r.n);
  };
  const schematic = (size: "main" | "inset") => (
    <Schematic
      index={index}
      group={lead}
      encoding={scale.encoding}
      selected={selected}
      lit={litAll}
      onSelect={(id) => pick(id)}
      onHover={onHover}
      size={size}
    />
  );

  const floaters = usePictureFloaters({
    picture,
    pose,
    bounds,
    scene,
    meshes: read.meshes,
    orbit,
    swap,
    small: () => schematic("inset"),
  });

  // The readout's subject: the pick being shown, else the Page's selection.
  const ruled = openRuling == null ? null : (rulings.find((r) => r.n === openRuling) ?? null);
  // The title is a breadcrumb: the system (press it to clear the selection), then the picked
  // element. Its state, a switch and a re-read speak in the plate: the header strip leaves the
  // title too little room for them.
  const pickedId =
    page.selected && /^\d+$/.test(page.selected) && !claims.some((c) => c.id === page.selected)
      ? Number(page.selected)
      : null;
  const pickedName = pickedId == null ? null : nameOf(pickedId);
  const subjects = useContext(SubjectTextContext);
  const systemState = identity.system ? systemIssues(identity.system) : [];
  const readId = shown ?? pickedId;
  const segFacts = readId == null ? null : scene.segments.find((f) => f.segment.id === readId);
  const nodeFacts = readId == null ? null : scene.nodes.find((f) => f.node.id === readId);
  // How Pe prices the selection's run (was the sidebar's run detail; selection lives here now).
  const run =
    priced && page.system && readId != null
      ? runOf(priced, systemScope(snapshot, page.system).groups, readId)
      : null;
  const title =
    systemName == null ? (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">All systems</span>
      </span>
    ) : (
      <span className="flex min-w-0 items-center gap-0.5" data-e-crumb="">
        {/* Priority when the header strip leaves little room: the system never shrinks, the
            picked element keeps a few letters, the root crumb gives way first. */}
        <button
          type="button"
          className="veil min-w-0 shrink-[8] truncate rounded-control px-1 text-ink-2 hover:text-ink"
          aria-label="show every system"
          onClick={identity.allSystems}
        >
          Systems
        </button>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-2" />
        {pickedName == null ? (
          <span className="shrink-0 px-1" title={systemName}>
            {systemName}
          </span>
        ) : (
          <TooltipHint content={`${systemName} · clear the selection`}>
            <button
              type="button"
              className="veil shrink-0 rounded-control px-1 text-ink-2 hover:text-ink"
              aria-label={`clear the selection in ${systemName}`}
              onClick={() => {
                setPage({ selected: "" }, { history: "push" });
                const fit = poseOf(null, bounds);
                if (fit && picture === "model")
                  flyTo(orbit, fit, {
                    history: null,
                    scene: bounds?.scene,
                    onLand: () => setPage({ viewport: null }, { history: "replace" }),
                  });
              }}
            >
              {systemName}
            </button>
          </TooltipHint>
        )}
        {pickedName == null || pickedId == null ? null : (
          <>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-2" />
            <TooltipHint content={`${pickedName} · go to it`}>
              {/* The picked element's name is a Subject: pressing it is the same alias-click as in text. */}
              <button
                type="button"
                className="veil min-w-[6ch] truncate rounded-control px-1"
                data-e-selected={pickedId}
                aria-label={`go to ${pickedName}`}
                onClick={() => subjects?.go(pickedId)}
              >
                {pickedName}
              </button>
            </TooltipHint>
          </>
        )}
      </span>
    );

  return (
    <Pane
      id="e-picture"
      title={title}
      scroll="clip"
      flush
      actions={
        <span className="inline-flex items-center gap-1">
          {pickedId != null ? (
            <SelectionBoxButton target={observedElements(observation, [pickedId])} />
          ) : null}
          <GoToSubject
            snapshot={snapshot}
            system={page.system}
            nameOf={nameOf}
            onHover={onHover}
            onGo={({ system, id }) => {
              if (id == null) return setPage({ system, selected: "" }, { history: "push" });
              if (system !== page.system)
                return setPage({ system, selected: String(id) }, { history: "push" });
              jumpTo(id);
            }}
          />
          <EncodingPicker value={scale.encoding.key} onPick={(key) => setPage({ encoding: key })} />
        </span>
      }
      modes={{
        label: "picture",
        value: picture,
        onChange: (key) => setPage({ picture: key as typeof picture }, { history: "push" }),
        // `S` sits on the other picture, so the one chord always swaps.
        options: (["model", "schematic"] as const).map((key) => ({
          key,
          label: key,
          chord: key === picture ? undefined : "S",
          says: `The ${key} large, the other in the corner`,
        })),
      }}
      layers={{
        value: page.layers,
        options: DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] })),
        onToggle: (key) =>
          setPage(
            {
              layers: toggleLayer(DUCTS_LAYERS, page.layers, key as (typeof DUCTS_LAYERS)[number]),
            },
            { history: "push" },
          ),
      }}
      floaters={floaters}
    >
      <div
        ref={setPictureHost}
        data-proto="E"
        className="relative flex size-full min-h-0 flex-col"
        onMouseUp={(e) => {
          // The mouse's back and forward buttons step the same history as Alt+arrows.
          if (e.button !== 3 && e.button !== 4) return;
          e.preventDefault();
          go(e.button === 3 ? "back" : "forward");
        }}
        onPointerDownCapture={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
          // A gesture is the eye moving on: the landing marks and the way back go.
          if (landed && !(e.target as Element).closest("[data-picture-readout]")) setLanded(null);
        }}
        onWheelCapture={(e) => {
          if (landed && !(e.target as Element).closest("[data-picture-readout]")) setLanded(null);
        }}
        onDoubleClickCapture={() => {
          const id = pendingSelection.current;
          if (id !== null) {
            clearTimeout(selectionPublish.current);
            pendingSelection.current = null;
            // Finish the selection render before the canvas starts its frame animation.
            flushSync(() => setPage({ selected: String(id) }, { history: "push" }));
          }
        }}
      >
        {picture === "model" ? (
          <ModelPicture
            read={read}
            bounds={bounds}
            orbit={orbit}
            wheelHost={pictureHost?.closest<HTMLElement>("[data-slot='pane-field']")}
            scene={scene}
            layers={layers}
            encoding={scale.encoding}
            selected={selected}
            lit={litAll}
            hovered={hovered}
            labels={labels}
            rulings={marks}
            findings3d={stageLayers}
            issues={issues}
            hoveredIssue={hoveredIssue}
            onIssueHover={onIssueHover}
            pointOf={pointOf}
            issue={page.issue}
            setPage={(next, move) => {
              // An issue picked in 3D is a picture pick: the camera stays.
              if (next.selected) hush(next.selected);
              setPage(next, move);
            }}
            onPick={pick}
            onRuling={ruling}
            onHover={onHover}
          />
        ) : (
          schematic("main")
        )}

        {landed?.box ? (
          <div
            aria-hidden
            data-e-landed=""
            className="pointer-events-none absolute text-ink outline outline-2 outline-current"
            style={{
              left: landed.box.x - 6,
              top: landed.box.y - 6,
              width: landed.box.width + 12,
              height: landed.box.height + 12,
            }}
            key={landed.n}
            ref={flash}
          />
        ) : null}

        {/* The plate: what the picture is of and the state it is in, readable without a hover;
            with an element selected, that element (kaitpw 2026-10-23: selection info lives here). */}
        <PictureReadout
          title={readId == null ? undefined : (nameOf(readId) ?? `element ${readId}`)}
          onClear={readId == null ? undefined : () => pick(null)}
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
          <OpeningNote />
          {identity.refreshing ? (
            <span className="text-ink-2" data-e-refreshing="">
              refreshing… the last read stays drawn
            </span>
          ) : null}
          {readId != null ? (
            <>
              {ruled && ruled.at === readId ? (
                <RulingBody
                  r={ruled}
                  nameOfId={nameOfId}
                  onVerdict={onVerdict}
                  onHover={onHover}
                  onPick={pick}
                />
              ) : null}
              {run ? (
                <RunDetail
                  run={run}
                  designRate={priced?.staged.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE}
                  nameOf={nameOf}
                  light={(ids) => onHover(ids?.[0] ?? null)}
                />
              ) : null}
              {noRuns.has(readId) ? (
                <p>
                  No run:{" "}
                  <SubjectText text={noRunParts(noRuns.get(readId)!, snapshot)} ids={[readId]} />
                </p>
              ) : null}
              {segFacts ? (
                <SegmentFactsView {...segFacts} />
              ) : nodeFacts ? (
                <NodeFactsView {...nodeFacts} />
              ) : (
                <p className="text-ink-2">
                  element {nameOfId(readId) ?? readId} is not drawn here
                </p>
              )}
              <p data-pe-loss={readId}>
                Pe loss <span className="face-mono">{fmt(index.loss.get(readId), 4)}</span> in-wg ·
                from fan <span className="face-mono">{fmtFt(cumulative.get(readId))}</span> eq ft
                {priced ? null : (
                  <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>
                )}
              </p>
              {sub?.legOf.get(readId) ? <p>on leg {sub.legOf.get(readId)!.name}</p> : null}
            </>
          ) : identity.system == null ? (
            <>
              <span className="truncate" data-e-census="">
                <span className="face-mono">{identity.census.systems}</span> systems
              </span>
              <span className="truncate">
                <span className="face-mono">{identity.census.priced}</span> priced ·{" "}
                <span className="face-mono">{identity.census.fix}</span> need a fix
              </span>
            </>
          ) : (
            <>
              <span data-e-state="">
                {systemState.length ? (
                  <>
                    <SystemMark issues={systemState} open={identity.open} />{" "}
                  </>
                ) : null}
                {solved?.fan == null ? (
                  <span data-tone={solved ? "alarm" : undefined}>
                    {solved ? "no ESP: an implausible loss" : "not priced"}
                  </span>
                ) : flowless.length ? (
                  // A terminal with no design flow is priced at 0 cfm, so the sum would read as a
                  // confident 0.000: missing reads as missing (house law 2), never as a number.
                  <span className="text-ink-2" data-readout-missing="">
                    no ESP: {flowless.length} of {terminals} grille{terminals === 1 ? "" : "s"}{" "}
                    {flowless.length === 1 ? "has" : "have"} no design flow
                  </span>
                ) : (
                  <>
                    {identity.breakdown ? (
                      <BarPopover
                        split={identity.breakdown.split}
                        scale={identity.breakdown.scale}
                        head={identity.breakdown.fans}
                        className="inline-flex! underline decoration-dotted decoration-line-2 underline-offset-2"
                      >
                        ESP <span className="face-mono">{fmt(solved.fan, 3)} in-wg</span>
                      </BarPopover>
                    ) : (
                      <>
                        ESP <span className="face-mono">{fmt(solved.fan, 3)} in-wg</span>
                      </>
                    )}
                    {solved.critical != null ? (
                      <>
                        {" "}
                        · TEL <span className="face-mono">{fmtFt(solved.criticalTel)} ft</span> to{" "}
                        {/* A name in text: the alias-click, which brings it into view. */}
                        <button
                          type="button"
                          className="underline decoration-line-2 underline-offset-2"
                          onClick={() =>
                            subjects ? subjects.go(solved.critical!) : pick(solved.critical!)
                          }
                        >
                          {criticalName}
                        </button>
                      </>
                    ) : null}{" "}
                    <ProvisionalNote provisional={solved.provisional} of="the fan static" />
                  </>
                )}
              </span>
              <span className="truncate text-ink-2" title={identity.system.sub} data-e-identity="">
                {identity.system.sub}
              </span>
            </>
          )}
        </PictureReadout>

        <div
          data-slot="pane-legend"
          className="absolute bottom-2 left-2 flex flex-col items-start gap-1"
        >
          <ScaleLegend
            encoding={scale.encoding}
            counts={scale.counts}
            nameOf={scale.nameOf}
            // The max's element is named in text: the alias-click, not a picture pick.
            onSelect={(id) => (subjects ? subjects.go(id) : pick(id))}
          />
          {picture === "model" ? <KeyLegend keys={PICTURE_KEYS} lead={0} /> : null}
        </div>

      </div>
    </Pane>
  );
}
