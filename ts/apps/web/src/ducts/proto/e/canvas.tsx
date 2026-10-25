import { useElementAttention } from "#/attention";
import { ButtonGroup } from "@pe/kit/lang/button-group";
/** The model/schematic pane, its fixed readout and floaters. Camera policy belongs to useStage. */
import { nameOrFallback } from "@pe/kit/lang/subject-text";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type RefObject,
} from "react";

import { DUCTS_LAYERS, emptyListSearch, toggleLayer } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { scopeOf, systemScope } from "@pe/ducts-domain/system-scope";
import { worstRun } from "@pe/ducts-domain/losses";
import type { Neighbour } from "@pe/ducts-domain/neighbours";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements } from "#/revit/observation";
import { Pane, PaneWork } from "@pe/kit/lang/pane";
import { useNativeObservation } from "#/revit/observation";
import { useScene, usePictureRead } from "#/scene/use-scene";
import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
import type { Bounds } from "#/scene/types";
import { Button } from "@pe/kit/lang/button";
import { viewportProject } from "#/scene/projection";

import type { Ruling } from "../../annotations";
import { elementNamer } from "../../claims";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { sceneRequestOf } from "../../manifest";
import { activeSystem, paintOfDucts, stubIdsOf, withSystem } from "../../selection";
import { findingLayers, findingShapes, noRunLayers } from "../../finding-layers";
import { boundsOfIds, ModelPicture, poseOf, usePictureBounds } from "../../model-picture";
import { PictureStage, useStage, stageViewport, projectBounds } from "#/scene/stage-controller";
import { GoToSubject } from "./go-to";
import { PictureReadout } from "@pe/kit/lang/readout";
import { RunDetail, runOf } from "./run-detail";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { ProvisionalNote } from "../../provisional";
import { indexOf, sceneOf, subjectScene } from "../../scene";
import { Schematic } from "../../schematic";
import { EncodingPicker } from "../encoding/picker";
import { ScaleLegend } from "../encoding/scale-legend";
import type { GroupEncoding } from "../encoding/use-encoding";
import type { ProtoProps } from "../props";
import { BarPopover, fmtFt, SystemMark, systemNoteCount } from "./bar";
import type { SystemNote } from "../../system-list-search";
import type { Split } from "../../loss-split";
import type { systemList } from "../../system-list";
import type { StageIssue } from "../../inbox-rows";
import { damageLayers } from "#/scene/damage";
import { land } from "@pe/kit/lang/land";
import { usePictureFloaters } from "./picture-floaters";
import { RulingBody, useMarks } from "./rulings";
import { noRunParts } from "../../subject-text";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { useHoveredIssue } from "#/attention";

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

// Keep the opening acknowledgement below the expensive picture/capture builders.
function DuctsReadout(props: ComponentProps<typeof PictureReadout>) {
  const opening = useContext(OpeningContext);
  return (
    <PictureReadout
      {...props}
      pending={opening == null ? props.pending : `opening ${opening || "every system"}`}
    />
  );
}

export interface ECanvasExtra {
  issues: readonly StageIssue[];
  onIssueHover: (key: string | null) => void;
  /** The open systems' groups (stable, `scopeOf`); the picture draws every one. */
  groups: readonly string[];
  /** The networks one unit away (`neighboursOf`): their stubs join the capture, painted `stub`. */
  neighbours: readonly Neighbour[];
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
    system: (ReturnType<typeof systemList>[number] & { note: SystemNote | undefined }) | null;
    census: { systems: number; priced: number; fix: number };
    refreshing: boolean;
    /** Opens the system's tree, where its issues stand. */
    open: () => void;
    /** The critical run's loss groups under the ESP, with the system's fans at its head. */
    breakdown: { split: Split; scale: number; fans: () => ReactNode } | null;
    allSystems: () => void;
  };
  /** The screen's alias picks call this when the subject is already the selection: fly again. */
  jump?: RefObject<((id: number) => void) | null>;
}

const landPicture = (node: HTMLDivElement | null) => {
  if (node) land(node);
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
  doc,
  priced,
  page,
  subject,
  claims,
  onVerdict,
  work,
  issueScope,
  annotated,
  issues,
  onIssueHover,
  groups,
  neighbours,
  lead,
  scale,
  nameOf,
  identity,
  jump,
  setPage,
  onSelect,
  onPose,
}: ProtoProps & ECanvasExtra & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
  const { hovered, onHover, lit } = useElementAttention();
  const hoveredIssue = useHoveredIssue();
  const observation = useNativeObservation();
  const index = useMemo(() => indexOf(snapshot, priced), [snapshot, priced]);
  const scope = useMemo(() => scopeOf(snapshot, page.system), [snapshot, page.system]);
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
  // Neighbour stubs never come from an open group, so none of them is already a subject.
  const opened = useMemo(() => {
    const groupSet = new Set(groups);
    return new Set([
      ...(scope?.members ?? []),
      ...[...snapshot.nodes, ...snapshot.segments]
        .filter((e) => e.groupId && groupSet.has(e.groupId))
        .map((e) => e.id),
      ...snapshot.groups.filter((g) => groupSet.has(g.id)).flatMap((g) => g.rootIds),
    ]);
  }, [snapshot, scope, groups]);
  const stubs = useMemo(() => stubIdsOf(neighbours, opened), [neighbours, opened]);
  const request = useMemo(
    () => sceneRequestOf(snapshot, page, groups, stubs),
    [snapshot, page.system, page.layers, groups, stubs],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const paintOf = useMemo(() => paintOfDucts(snapshot, opened, stubs), [snapshot, opened, stubs]);
  const capture = useScene(request, native, page.epoch);
  const pictureKey = doc && request ? `${doc.session}/${doc.openId}` : null;
  const { read, holding } = usePictureRead(
    capture,
    pictureKey,
    page.system.join(", "),
    identity.refreshing,
  );
  const bounds = usePictureBounds(read.meshes, scene);
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
  const picture = page.picture;
  const swap = () =>
    setPage({ picture: picture === "model" ? "schematic" : "model" }, { history: "push" });

  const sub = scene.subject ?? null;
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const pointer = useRef({ x: 0, y: 0 });
  const [openRuling, setOpenRuling] = useState<number | null>(null);
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
      priced && page.system.length
        ? noRunBranches(
            priced.snapshot,
            priced.next,
            scopeOf(priced.snapshot, page.system)!,
            priced.flows,
          )
        : new Map(),
    [priced, page.system],
  );
  const findings3d = useMemo(
    () => findingLayers(findingShapes(snapshot, annotated, work.doc, scope?.members), issues),
    [snapshot, annotated, work.doc, scope, issues],
  );

  const damage = useMemo(
    () => (read.meshes ? damageLayers(read.meshes, issues) : []),
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
    (page.system.join(" + ") || null) ??
    (firstId == null
      ? null
      : (byId.segments.get(firstId)?.systemName ?? byId.nodes.get(firstId)?.systemName)) ??
    null;
  const groupId =
    lead ||
    (firstId == null
      ? ""
      : (byId.segments.get(firstId)?.groupId ?? byId.nodes.get(firstId)?.groupId ?? ""));
  const active = activeSystem(page);
  const activeScope = priced && active ? systemScope(priced.snapshot, active) : null;
  const worst =
    priced && activeScope ? worstRun(priced.next, activeScope.groups, activeScope.terminals) : null;
  const groupSolve = groupId ? priced?.next.byGroup[groupId] : null;
  const solved = groupSolve && {
    fan: activeScope?.groups.some((g) => (priced?.next.byGroup[g]?.implausible.length ?? 0) > 0)
      ? null
      : (worst?.total ?? null),
    critical: worst?.terminal ?? null,
    criticalTel: worst?.tel ?? null,
    provisional:
      (worst && priced?.next.paths[worst.terminal]?.provisional) ?? groupSolve.provisional,
  };
  const criticalName = solved?.critical != null ? nameOf(solved.critical) : null;
  const scopeTerminals = activeScope?.terminals ?? null;
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
    if (id == null || !Number.isFinite(id))
      return new Set(issues.find((row) => row.key === page.issue)?.ids ?? []);
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  }, [page.selected, page.issue, issues, claims, sub]);

  // Where a box in the world sits on screen now, from the live camera; null when off the picture.
  const onScreen = (b: Bounds | null): DOMRect | null => {
    const rect = pictureHost?.querySelector("[data-model-picture]")?.getBoundingClientRect();
    const now = orbit.read();
    const project = b && now && bounds && rect ? viewportProject(now, bounds.scene, rect) : null;
    return b && project && rect ? projectBounds(b, project, rect) : null;
  };
  const pick = (id: number | null) => {
    setOpenRuling(null);
    setPage({ selected: id == null ? "" : String(id), issue: "" }, { history: "push" });
  };
  useEffect(() => {
    if (!page.selected) setOpenRuling(null);
  }, [page.selected]);

  // A named alias jump writes selection and view together; its landing marks the subject.
  const [landed, setLanded] = useState<{ box: DOMRect | null; back: string; n: number } | null>(
    null,
  );
  const selectionOf = (id: number) => {
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  };
  const ruling = (r: Ruling) => {
    const finding =
      r.kind === "claim" ? `claim:${r.claim.id}` : r.kind === "issue" ? r.issue.id : r.finding.id;
    const issue = issues.find((i) => i.findings.includes(finding))?.key ?? finding;
    setPage(
      { selected: String(r.at), issue, rulingSearch: emptyListSearch() },
      { history: "push" },
    );
    setOpenRuling(r.n);
  };
  const schematic = (size: "main" | "inset", readout: ReactNode = null) => (
    <Schematic
      index={index}
      group={lead}
      encoding={scale.encoding}
      onSelect={(id) => pick(id)}
      size={size}
      readout={readout}
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

  const ruled = openRuling == null ? null : (rulings.find((r) => r.n === openRuling) ?? null);
  const pickedId =
    page.selected && /^\d+$/.test(page.selected) && !claims.some((c) => c.id === page.selected)
      ? Number(page.selected)
      : null;
  const subjects = useContext(SubjectTextContext);
  const systemState = identity.system
    ? systemNoteCount(identity.system, identity.system.note)
    : { issues: [], total: 0 };
  const readId = pickedId;
  const segFacts = readId == null ? null : scene.segments.find((f) => f.segment.id === readId);
  const nodeFacts = readId == null ? null : scene.nodes.find((f) => f.node.id === readId);
  // How Pe prices the selection's run (was the sidebar's run detail; selection lives here now).
  const run = priced && scope && readId != null ? runOf(priced, scope.groups, readId) : null;

  const viewOf = (stage: ReturnType<typeof useStage>, ids: ReadonlySet<number>) =>
    picture === "model" ? stage.poseOf(boundsOfIds(read.meshes, scene, ids)) : null;
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
  const jumpTo = (stage: ReturnType<typeof useStage>, id: number) => {
    const ids = selectionOf(id);
    const view = viewOf(stage, ids);
    const same = String(id) === page.selected;
    setLanded(null);
    if (!view) return same ? undefined : onSelect(id);
    landing.current = markLanding(ids, same ? "the previous view" : backWord());
    setPage(same ? { viewport: view } : { selected: String(id), issue: "", viewport: view }, {
      history: "push",
    });
  };

  return (
    <PictureStage
      goTo={(stage) => (
        <GoToSubject
          snapshot={snapshot}
          systems={page.system}
          nameOf={nameOf}
          onHover={onHover}
          onGo={({ system, id }) => {
            if (id == null)
              return setPage(
                { system: withSystem(page.system, system), selected: "" },
                { history: "push" },
              );
            if (scope && !scope.members.has(id))
              return setPage(
                { system: withSystem(page.system, system), selected: String(id) },
                { history: "push" },
              );
            jumpTo(stage, id);
          }}
        />
      )}
      {...{
        kind: "orbit",
        orbit,
        bounds,
        host: pictureHost,
        selectedBounds: boundsOfIds(read.meshes, scene, selected),
        clearSelection: () => {
          if (page.selected || page.issue) pick(null);
        },
        onHistoryStep: () => setLanded(null),
      }}
    >
      {(stage) => {
        if (jump) jump.current = (id) => jumpTo(stage, id);
        const goBack = () => stage.go("back");

        const readout = (
          <DuctsReadout
            subject={systemName ?? undefined}
            title={readId == null ? undefined : nameOrFallback(nameOf(readId))}
            pending={read.pending ? "refreshing" : undefined}
            retained={
              holding
                ? `showing ${holding.system}`
                : read.pending
                  ? "the last read stays drawn"
                  : undefined
            }
            summary={
              readId != null ? undefined : identity.system == null ? (
                <span className="truncate" data-e-census="">
                  <span className="face-mono">{identity.census.systems}</span> systems
                </span>
              ) : (
                <span data-e-state="">
                  {systemState.total ? (
                    <>
                      <SystemMark
                        issues={systemState.issues}
                        total={systemState.total}
                        open={identity.open}
                      />{" "}
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
                      no ESP: {flowless.length} of {terminals} grille
                      {terminals === 1 ? "" : "s"} {flowless.length === 1 ? "has" : "have"} no
                      design flow
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
                          · TEL <span className="face-mono">
                            {fmtFt(solved.criticalTel)} ft
                          </span> to{" "}
                          {/* A name in text: the alias-click, which brings it into view. */}
                          <button
                            type="button"
                            className="underline decoration-line-2 underline-offset-2"
                            onClick={() =>
                              subjects?.go ? subjects.go(solved.critical!) : pick(solved.critical!)
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
              )
            }
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
            {readId != null ? (
              <>
                {ruled && ruled.at === readId ? (
                  <RulingBody r={ruled} onVerdict={onVerdict} />
                ) : null}
                {run ? (
                  <RunDetail
                    run={run}
                    designRate={priced?.staged.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE}
                    nameOf={nameOf}
                  />
                ) : null}
                {noRuns.has(readId) ? (
                  <p>
                    No run:{" "}
                    <SubjectText
                      text={noRunParts(noRuns.get(readId)!, snapshot)}
                      revit={[readId]}
                    />
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
                  Pe loss <span className="face-mono">{fmt(index.loss.get(readId), 4)}</span> in-wg
                  · from fan <span className="face-mono">{fmtFt(cumulative.get(readId))}</span> eq
                  ft
                  {priced ? null : (
                    <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>
                  )}
                </p>
                {sub?.legOf.get(readId) ? <p>on leg {sub.legOf.get(readId)!.name}</p> : null}
              </>
            ) : identity.system == null ? (
              <>
                <span className="truncate">
                  <span className="face-mono">{identity.census.priced}</span> priced ·{" "}
                  <span className="face-mono">{identity.census.fix}</span> need a fix
                </span>
              </>
            ) : (
              <>
                <TooltipHint content={identity.system.sub}>
                  <span className="truncate text-ink-2" data-e-identity="">
                    {identity.system.sub}
                  </span>
                </TooltipHint>
              </>
            )}
          </DuctsReadout>
        );
        const model = (
          <ModelPicture
            paintOf={paintOf}
            readout={readout}
            read={read}
            bounds={bounds}
            orbit={orbit}
            wheelHost={pictureHost?.closest<HTMLElement>("[data-slot='pane-field']")}
            scene={scene}
            layers={layers}
            encoding={scale.encoding}
            selected={selected}
            lit={lit}
            hovered={hovered}
            labels={labels}
            rulings={marks}
            findings3d={stageLayers}
            issues={issues}
            hoveredIssue={hoveredIssue}
            onIssueHover={onIssueHover}
            pointOf={pointOf}
            issue={page.issue}
            setPage={setPage}
            onPick={pick}
            onRuling={ruling}
          />
        );
        return (
          <Pane
            picture
            id="e-picture"
            title={
              <Button label="All systems" onClick={identity.allSystems}>
                Systems
              </Button>
            }
            scroll="clip"
            flush
            actions={
              <ButtonGroup>
                {pickedId != null ? (
                  <SelectionBoxButton target={observedElements(observation, [pickedId])} />
                ) : null}
                {stage.goTo}
                <EncodingPicker
                  value={scale.encoding.key}
                  onPick={(key) => setPage({ encoding: key })}
                />
              </ButtonGroup>
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
              options: DUCTS_LAYERS.map((key) => ({
                key,
                ...LAYER_WORDS[key],
                busy: key === "context" && read.pending,
              })),
              onToggle: (key) =>
                setPage(
                  {
                    layers: toggleLayer(
                      DUCTS_LAYERS,
                      page.layers,
                      key as (typeof DUCTS_LAYERS)[number],
                    ),
                  },
                  { history: "push" },
                ),
            }}
            legend={
              <ScaleLegend
                encoding={scale.encoding}
                counts={scale.counts}
                nameOf={scale.nameOf}
                // The max's element is named in text: the alias-click, not a picture pick.
                onSelect={(id) => (subjects?.go ? subjects.go(id) : pick(id))}
              />
            }
            floaters={floaters}
          >
            <PaneWork pending={identity.refreshing} />
            <div
              ref={setPictureHost}
              data-proto="E"
              aria-busy={read.pending || undefined}
              data-reading={read.pending ? "pending" : undefined}
              className="relative flex size-full min-h-0 flex-col"
              onPointerDownCapture={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY };
                // A gesture is the eye moving on: the landing marks and the way back go.
                if (landed && !(e.target as Element).closest("[data-picture-readout]"))
                  setLanded(null);
              }}
              onWheelCapture={(e) => {
                if (read.pending) {
                  e.nativeEvent.preventDefault();
                  e.stopPropagation();
                  return;
                }
                if (landed && !(e.target as Element).closest("[data-picture-readout]"))
                  setLanded(null);
              }}
            >
              {picture === "model" ? model : schematic("main", readout)}

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
          </Pane>
        );
      }}
    </PictureStage>
  );
}
