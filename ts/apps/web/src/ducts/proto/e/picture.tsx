/**
 * E's picture content: what the ducts picture is of and what it marks. Every picture behaviour
 * (capture, camera, selection, hover, readout and pane furniture) is the shared `Picture`'s; this
 * file only produces content for it.
 */
import { useElementAttention } from "#/attention";
import { elementKey, type Members, type SubjectKey } from "@pe/kit/lang/attention";
import { useContext, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";

import { emptyListSearch } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { scopeOf, systemScope } from "@pe/ducts-domain/system-scope";
import { worstRun } from "@pe/ducts-domain/losses";
import type { Neighbour } from "@pe/ducts-domain/neighbours";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Button } from "@pe/kit/lang/button";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { damageLayers } from "#/scene/damage";
import type { Layer3D, SceneMeshes } from "#/scene/types";
import {
  idOf,
  Picture,
  type PictureContent,
  type PictureLayer,
  type PictureOverlayFrame,
} from "#/scene/picture/picture";
import { frozenDemo } from "#/host/demo-client";
import { VisibleRouteResource } from "#/route/activity";

import type { Ruling } from "../../annotations";
import { DuctsOverlay, linesOf, useEquipment } from "../../picture-content";
import { elementNamer } from "../../claims";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { ductsFocus } from "../../manifest";
import { activeSystem, paintOfDucts, stubIdsOf, withSystem } from "../../selection";
import { findingLayers, findingShapes, noRunLayers } from "../../finding-layers";
import { GoToSubject } from "./go-to";
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
import { DUCTS_LAYER_OPTIONS } from "./teaching";
import { RulingBody, useMarks } from "./rulings";
import { noRunParts } from "../../subject-text";
import { stubLabels } from "../../stub-labels";
import { coloursOf } from "../../colours";
import { COLOURS_FIXTURE } from "../../colours.fixture";

const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));
const NO_FOCUS: PictureContent["focus"] = { walked: [], near: [] };
/** A tree group lights under an element hovered in 3D; an issue's set does not. */
const hoverGroups = (group: SubjectKey) => !group.startsWith("issue:");

export interface DuctsPictureExtra {
  renderPane: TeachingPaneRender;
  issues: readonly StageIssue[];
  /** The open systems' groups (stable, `scopeOf`); the picture draws every one. */
  groups: readonly string[];
  members?: ReadonlySet<number>;
  /** Issue rows and tree nodes to their elements: the picture registers them on attention. */
  membership: Members;
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
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}

export function DuctsPicture(props: ProtoProps & DuctsPictureExtra) {
  const { snapshot } = props;
  if (!snapshot)
    return (
      <p className="p-3 text-ink-2">
        {props.empty?.says ?? (props.reading.pending ? "reading ducts…" : "no snapshot")}
      </p>
    );
  // Route UI stays retained; capture buffers, clipped meshes and layer descriptors do not.
  return (
    <VisibleRouteResource>
      <Content {...props} snapshot={snapshot} />
    </VisibleRouteResource>
  );
}

function Content({
  renderPane,
  snapshot,
  captureSource,
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
  groups,
  members,
  membership,
  neighbours,
  lead,
  scale,
  nameOf,
  identity,
  jump,
  selection,
  setPage,
  onPose,
}: ProtoProps & DuctsPictureExtra & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
  const { onHover } = useElementAttention();
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
        : sceneOf(index, groups, () => true, members),
    [index, snapshot, subject, labelOf, groups, members],
  );
  const opened = useMemo(
    () => members ?? new Set([...snapshot.nodes, ...snapshot.segments].map((e) => e.id)),
    [snapshot, members],
  );
  const stubs = useMemo(() => stubIdsOf(neighbours, opened), [neighbours, opened]);
  // E's system scope is one producer of focus: its members walked, the neighbours' stubs near.
  const focus = useMemo(
    () => ductsFocus(snapshot, page.system, members, stubs) ?? NO_FOCUS,
    [snapshot, page.system, members, stubs],
  );
  const systemColours = page.layers.includes("system-colours");
  const colours = coloursOf(work.doc);
  const routePaint = useMemo(
    () => paintOfDucts(snapshot, opened, stubs),
    [snapshot, opened, stubs],
  );
  const stubNames = useMemo(
    () => stubLabels(snapshot, neighbours, opened),
    [snapshot, neighbours, opened],
  );
  const meshCuts = useMemo(() => {
    const cuts = new Map<number, (typeof neighbours)[number]["cuts"]>();
    for (const id of stubs) {
      const branches = neighbours.filter((n) => n.stub.includes(id));
      if (branches.every((n) => n.cuts.some((cut) => cut.id === id)))
        cuts.set(
          id,
          branches.flatMap((n) => n.cuts.filter((cut) => cut.id === id)),
        );
    }
    return cuts;
  }, [neighbours, stubs]);
  const capture = useMemo(
    () => ({
      cuts: meshCuts,
      meshes:
        import.meta.env.DEV && frozenDemo() === "colours" ? COLOURS_FIXTURE.meshes : undefined,
    }),
    [meshCuts],
  );
  const lines = useMemo(() => linesOf(scene), [scene]);

  const sub = scene.subject ?? null;
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
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
  // Damage follows the shown meshes; the layer and the overlay's covered pins share one per read.
  const damageOf = useMemo(() => {
    const damage = new WeakMap<SceneMeshes, Layer3D[]>();
    return (meshes: SceneMeshes | null) => {
      if (!meshes) return [];
      let layers = damage.get(meshes);
      if (!layers) damage.set(meshes, (layers = damageLayers(meshes, issues)));
      return layers;
    };
  }, [issues]);
  const noRuns3d = useMemo(() => noRunLayers(noRuns, snapshot, issues), [noRuns, snapshot, issues]);
  const kinds = colours;
  const colour = systemColours ? "firm" : "mono";
  const { paint, ports } = useEquipment(scene, routePaint, kinds, colour);
  // Each stage mark answers its own picture layer: no-runs to `no-run`, findings and damage to `findings`.
  const layers = useMemo<PictureLayer[]>(
    () => [
      { key: "no-run", toggle: "no-run", draw: () => noRuns3d },
      {
        key: "findings",
        toggle: "findings",
        draw: ({ meshes }) => [...findings3d, ...damageOf(meshes)],
      },
      ports,
    ],
    [noRuns3d, findings3d, damageOf, ports],
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
    fan: activeScope?.groups.some((g) =>
      priced?.next.byGroup[g]?.implausible.some((id) => activeScope.prices.has(id)),
    )
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

  // A page write, as the tree's: the picture registers the selection it becomes.
  const pick = (id: number | null) => {
    setOpenRuling(null);
    setPage({ selected: id == null ? "" : String(id), issue: "" }, { history: "push" });
  };
  useEffect(() => {
    if (!page.selected) setOpenRuling(null);
  }, [page.selected]);
  const widen = useMemo(
    () =>
      sub
        ? (key: SubjectKey) => sub.legOf.get(idOf(key))?.ids.map((id) => elementKey(id)) ?? []
        : undefined,
    [sub],
  );

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
      groups={groups}
      members={members}
      encoding={scale.encoding}
      onSelect={(id) => pick(id)}
      size={size}
      readout={readout}
    />
  );

  const ruled = openRuling == null ? null : (rulings.find((r) => r.n === openRuling) ?? null);
  const subjects = useContext(SubjectTextContext);
  const systemState = identity.system
    ? systemNoteCount(identity.system, identity.system.note)
    : { issues: [], total: 0 };
  const facts = (key: SubjectKey) => {
    const readId = idOf(key);
    const segFacts = scene.segments.find((f) => f.segment.id === readId);
    const nodeFacts = scene.nodes.find((f) => f.node.id === readId);
    // How Pe prices the selection's run (was the sidebar's run detail; selection lives here now).
    const run = priced && scope ? runOf(priced, scope.groups, readId) : null;
    return (
      <>
        {ruled && ruled.at === readId ? <RulingBody r={ruled} onVerdict={onVerdict} /> : null}
        {run ? (
          <RunDetail
            run={run}
            designRate={priced?.edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE}
            nameOf={nameOf}
          />
        ) : null}
        {noRuns.has(readId) ? (
          <p>
            No run:{" "}
            <SubjectText text={noRunParts(noRuns.get(readId)!, snapshot)} revit={[readId]} />
          </p>
        ) : null}
        {segFacts ? (
          <SegmentFactsView {...segFacts} />
        ) : nodeFacts ? (
          <NodeFactsView {...nodeFacts} />
        ) : (
          <p className="text-ink-2">element {nameOfId(readId) ?? readId} is not drawn here</p>
        )}
        <p data-pe-loss={readId}>
          Pe loss <span className="face-mono">{fmt(index.loss.get(readId), 4)}</span> in-wg · from
          fan <span className="face-mono">{fmtFt(cumulative.get(readId))}</span> eq ft
          {priced ? null : <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>}
        </p>
        {sub?.legOf.get(readId) ? <p>on leg {sub.legOf.get(readId)!.name}</p> : null}
      </>
    );
  };
  const summary =
    identity.system == null ? (
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
            {terminals === 1 ? "" : "s"} {flowless.length === 1 ? "has" : "have"} no design flow
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
    );
  const idle =
    identity.system == null ? (
      <span className="truncate">
        <span className="face-mono">{identity.census.priced}</span> priced ·{" "}
        <span className="face-mono">{identity.census.fix}</span> need a fix
      </span>
    ) : (
      <TooltipHint content={identity.system.sub}>
        <span className="truncate text-ink-2" data-e-identity="">
          {identity.system.sub}
        </span>
      </TooltipHint>
    );
  const marksOn = new Set<string>(page.layers);
  const overlay = (frame: PictureOverlayFrame) => (
    <DuctsOverlay
      frame={frame}
      scene={scene}
      layers={marksOn}
      encoding={scale.encoding}
      labels={[...stubNames, ...labels]}
      rulings={rulings}
      // A pin the 3D marks already carry is not drawn twice.
      covered={[
        ...(marksOn.has("no-run") ? noRuns3d : []),
        ...(marksOn.has("findings") ? [...findings3d, ...damageOf(frame.meshes)] : []),
      ]}
      issues={issues}
      pointOf={pointOf}
      issue={page.issue}
      onRuling={ruling}
    />
  );

  return (
    <Picture
      selection={selection}
      source={{
        // Pricing withdraws action authority, but does not invalidate current native geometry.
        native: captureSource?.document ?? null,
        doc,
        version: captureSource?.version ?? "",
        label: page.system.join(", "),
        refreshing: identity.refreshing,
      }}
      page={page}
      setPage={setPage}
      renderPane={renderPane}
      onPose={onPose}
      jump={jump}
      content={{
        focus,
        members: membership,
        hoverGroups,
        widen,
        capture,
        lines,
        name: (key) => nameOf(idOf(key)),
        paint,
        kinds,
        colour,
        layers,
        layerOptions: DUCTS_LAYER_OPTIONS,
        overlay,
        readout: { subject: systemName ?? undefined, summary, idle, facts },
        schematic,
        goTo: (jumpTo) => (
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
              jumpTo(elementKey(id));
            }}
          />
        ),
        furniture: {
          title: (
            <Button label="All systems" onClick={identity.allSystems}>
              Systems
            </Button>
          ),
          actions: (
            <EncodingPicker
              value={scale.encoding.key}
              onPick={(key) => setPage({ encoding: key })}
            />
          ),
          legend: (
            <ScaleLegend
              encoding={scale.encoding}
              counts={scale.counts}
              nameOf={scale.nameOf}
              // The max's element is named in text: the alias-click, not a picture pick.
              onSelect={(id) => (subjects?.go ? subjects.go(id) : pick(id))}
            />
          ),
        },
        onIssuePick: (target) =>
          setPage(
            {
              selected: String(target.elementId),
              issue: target.key,
              rulingSearch: emptyListSearch(),
            },
            { history: "push" },
          ),
        onPick: () => setOpenRuling(null),
      }}
    />
  );
}
