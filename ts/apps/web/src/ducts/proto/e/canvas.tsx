/**
 * The picture pane: one `Pane` whose strip holds the picture mode (model or schematic, `S` swaps),
 * the layers, and two floaters, the orbit globe (`G`) and the other picture small (a click swaps).
 * The model is the subject system's real meshes (`model-picture.tsx`) with its annotations; the
 * schematic is the one-line. Element facts open beside its projected box; rulings open at the pointer. A pick, a
 * frame, a look and a gesture each write only their own Page keys.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { DUCTS_LAYERS, emptyListSearch, toggleLayer } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { ChevronRight } from "lucide-react";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements } from "#/revit/observation";
import { KeyLegend } from "#/components/lang/kbd";
import { Pane } from "#/components/lang/pane";
import { useNativeObservation } from "#/revit/observation";
import { useScene } from "#/scene/use-scene";
import { useLiveOrbit } from "#/scene/live-orbit";
import { boundsOfInstances } from "#/scene/orbit";
import { viewportProject } from "#/scene/projection";

import type { Ruling } from "../../annotations";
import { elementNamer } from "../../claims";
import { PICTURE_KEYS } from "../../docs";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { sceneRequestOf } from "../../manifest";
import { findingLayers, findingShapes } from "../../finding-layers";
import { ModelPicture, poseOf, usePictureBounds } from "../../model-picture";
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
import { usePictureFloaters } from "./picture-floaters";
import { RulingBody, useMarks } from "./rulings";
import { noRunParts } from "../../subject-text";
import { SubjectText, SubjectTextContext } from "../../subject-text-view";

type Open =
  | { what: "element"; id: number; x: number; y: number; box: DOMRect; side: "left" | "right" }
  | { what: "ruling"; n: number; x: number; y: number }
  | null;

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
}

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
  setPage,
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
    () => sceneRequestOf(snapshot, page),
    [snapshot, page.system, page.layers],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const read = useScene(request, native, page.epoch);
  const bounds = usePictureBounds(read.meshes, scene);
  const committedPose = useMemo(() => poseOf(page.viewport, bounds), [page.viewport, bounds]);
  const pose = committedPose;
  const orbit = useLiveOrbit(
    committedPose,
    (viewport, how) => setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" }),
    `${native?.session}/${native?.openId}/${page.system}/${page.picture}`,
    page.viewport,
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
  const [open, setOpen] = useState<Open>(null);
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
      setOpen(null);
      setPage({ selected: "" }, { history: "push" });
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", escapePending, true);
    return () => document.removeEventListener("keydown", escapePending, true);
  }, [setPage]);
  const mountFacts = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || open?.what !== "element" || pendingSelection.current !== open.id) return;
      // Two RAFs can run only 3 ms apart in headless Chrome, before a visible paint. Give the
      // mounted portal 50 ms before the router expands the sidebar's expensive selection rows.
      clearTimeout(selectionPublish.current);
      selectionPublish.current = setTimeout(() => {
        selectionPublish.current = undefined;
        if (pendingSelection.current !== open.id) return;
        pendingSelection.current = null;
        setPage({ selected: String(open.id) }, { history: "push" });
      }, 50);
    },
    [open, setPage],
  );
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
  const stageLayers = useMemo(() => [...findings3d, ...damage], [findings3d, damage]);
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

  // Opening facts is local and urgent. Updating the address also renders the tree and rules;
  // let that work follow the first paint instead of holding the popover behind it.
  const pick = (id: number | null, at = pointer.current) => {
    pendingSelection.current = id;
    const host = pictureHost?.querySelector("[data-model-picture]");
    const rect = host?.getBoundingClientRect();
    const now = orbit.read();
    const b =
      id != null && read.meshes ? boundsOfInstances(read.meshes, (i) => i.revitId === id) : null;
    const project = now && bounds && rect ? viewportProject(now, bounds.scene, rect) : null;
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
    const box = points.length
      ? DOMRect.fromRect({
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        })
      : DOMRect.fromRect({ ...at, width: 0, height: 0 });
    setOpen(
      id == null
        ? null
        : {
            what: "element",
            id,
            ...at,
            box,
            side: box.left > window.innerWidth - box.right ? "left" : "right",
          },
    );
    if (id == null) {
      clearTimeout(selectionPublish.current);
      setPage({ selected: "" }, { history: "push" });
    }
  };
  useEffect(() => {
    if (!page.selected) setOpen(null);
  }, [page.selected]);
  const ruling = (r: Ruling, at: { x: number; y: number }) => {
    clearTimeout(selectionPublish.current);
    pendingSelection.current = null;
    const finding =
      r.kind === "claim" ? `claim:${r.claim.id}` : r.kind === "issue" ? r.issue.id : r.finding.id;
    const issue = issues.find((i) => i.findings.includes(finding))?.key ?? finding;
    setPage({ selected: String(r.at), issue, rulingSearch: emptyListSearch() }, { history: "push" });
    setOpen({ what: "ruling", n: r.n, ...at });
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

  const openRuling = open?.what === "ruling" ? rulings.find((r) => r.n === open.n) : null;
  const elementId = open?.what === "element" ? open.id : null;
  const segFacts =
    elementId == null ? null : scene.segments.find((f) => f.segment.id === elementId);
  const nodeFacts = elementId == null ? null : scene.nodes.find((f) => f.node.id === elementId);
  const anchor = open
    ? {
        getBoundingClientRect: () =>
          open.what === "element"
            ? open.box
            : DOMRect.fromRect({ x: open.x, y: open.y, width: 0, height: 0 }),
      }
    : undefined;

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
              onClick={() => setPage({ selected: "" }, { history: "push" })}
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
        onPointerDownCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onPointerMoveCapture={(e) => {
          if (
            open &&
            e.buttons &&
            Math.hypot(e.clientX - pointer.current.x, e.clientY - pointer.current.y) > 5
          )
            setOpen(null);
        }}
        onWheelCapture={() => {
          if (open) setOpen(null);
        }}
        onDoubleClickCapture={() => {
          const id = pendingSelection.current;
          if (id !== null) {
            clearTimeout(selectionPublish.current);
            pendingSelection.current = null;
            // Finish the selection render before the canvas starts its frame animation.
            flushSync(() => setPage({ selected: String(id) }, { history: "push" }));
          }
          setOpen(null);
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
            noRuns={noRuns}
            pointOf={pointOf}
            issue={page.issue}
            setPage={setPage}
            onPick={pick}
            onRuling={ruling}
            onHover={onHover}
          />
        ) : (
          schematic("main")
        )}

        {/* The plate: what the picture is of and the state it is in, readable without a hover. */}
        <div
          className="absolute left-2 top-2 flex max-w-[calc(100%-15rem)] min-w-0 flex-col gap-0.5 t-small px-1.5 py-1"
          data-surface="page"
          data-proto-c-header=""
        >
          <OpeningNote />
          {identity.refreshing ? (
            <span className="text-ink-2" data-e-refreshing="">
              refreshing… the last read stays drawn
            </span>
          ) : null}
          {identity.system == null ? (
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
                        <button
                          type="button"
                          className="underline decoration-line-2 underline-offset-2"
                          onClick={() => pick(solved.critical!)}
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
        </div>

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

        <Popover
          open={!!open}
          onOpenChange={(o, details) => {
            if (o) return;
            setOpen(null);
            if (details.reason === "escape-key") {
              clearTimeout(selectionPublish.current);
              pendingSelection.current = null;
              setPage({ selected: "" }, { history: "push" });
            }
          }}
        >
          <PopoverContent
            ref={mountFacts}
            anchor={anchor}
            side={open?.what === "element" ? open.side : "bottom"}
            collisionAvoidance={{ side: "none", align: "shift" }}
            initialFocus={false}
            finalFocus={false}
            data-proto-c-popover={open?.what ?? ""}
          >
            {openRuling ? (
              <RulingBody
                r={openRuling}
                nameOfId={nameOfId}
                onVerdict={onVerdict}
                onHover={onHover}
                onPick={pick}
              />
            ) : elementId != null ? (
              <div className="flex flex-col gap-2">
                {noRuns.has(elementId) ? (
                  <p>
                    No run:{" "}
                    <SubjectText
                      text={noRunParts(noRuns.get(elementId)!, snapshot)}
                      ids={[elementId]}
                    />
                  </p>
                ) : null}
                {segFacts ? (
                  <SegmentFactsView {...segFacts} />
                ) : nodeFacts ? (
                  <NodeFactsView {...nodeFacts} />
                ) : (
                  <p className="text-ink-2">
                    element {nameOfId(elementId) ?? elementId} is not drawn here
                  </p>
                )}
                <p data-pe-loss={elementId}>
                  Pe loss <span className="face-mono">{fmt(index.loss.get(elementId), 4)}</span>{" "}
                  in-wg · from fan{" "}
                  <span className="face-mono">{fmtFt(cumulative.get(elementId))}</span> eq ft
                  {priced ? null : (
                    <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>
                  )}
                </p>
                {sub?.legOf.get(elementId) ? <p>on leg {sub.legOf.get(elementId)!.name}</p> : null}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </Pane>
  );
}
