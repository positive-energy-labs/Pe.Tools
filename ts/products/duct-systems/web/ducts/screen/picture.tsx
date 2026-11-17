import type { DuctSnapshot } from "@pe/ducts-domain/types";

/**
 * E's picture content: what the ducts picture is of and what it marks, as parts for the kernel's
 * picture pane (`route/slots/picture`). Every picture behaviour (capture, camera, selection, hover,
 * readout and pane furniture) is the kernel's; this file mounts no picture.
 */ import type { Members, SubjectKey } from "@pe/kit/lang/attention";
import { ductElements } from "@pe/ducts-web/ducts/identity";
import { useContext, useMemo, type ReactNode, type RefObject } from "react";

import { VisibleRouteResource } from "../../../../../apps/web/src/route/activity.tsx";
import { damageLayers } from "../../../../../apps/web/src/scene/damage.ts";
import {
  layersOn,
  type PictureLayer,
  type PictureOverlayFrame,
} from "../../../../../apps/web/src/scene/picture/picture.tsx";
import type { Layer3D, SceneMeshes } from "../../../../../apps/web/src/scene/types.ts";
import { emptyListSearch } from "@pe/agent-contracts";
import { runsOf, worstRun } from "@pe/ducts-domain/calc-runs";
import type { Neighbour } from "@pe/ducts-domain/neighbours";
import { noRunBranches } from "@pe/duct-systems-domain/no-runs";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { scopeOf, systemScope } from "@pe/ducts-domain/system-scope";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { SubjectText } from "@pe/kit/lang/subject-text";
import type { PictureParts } from "../../../../../apps/web/src/route/slots/picture/overlay.tsx";
import { TooltipHint } from "@pe/kit/lang/tooltip";

import { useAdmittedSubject } from "../../../../../apps/web/src/shell/subject.ts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/duct-systems-domain/equivalent-length";
import type { Priced } from "@pe/ducts-web/ducts/priced";
import { fanFacts } from "./fan-sections.tsx";
import type { DuctsDrawContext } from "../../route.ts";
import { network } from "../../route.ts";
import type { Ruling } from "@pe/ducts-web/ducts/annotations";
import { elementNamer } from "@pe/ducts-web/ducts/element-names";
import { coloursOf } from "@pe/ducts-web/ducts/colours";
import { NodeFactsView, SegmentFactsView } from "@pe/ducts-web/ducts/facts";
import { findingLayers, findingShapes, noRunLayers } from "@pe/ducts-web/ducts/finding-layers";
import type { StageIssue } from "../inbox-rows.ts";
import type { Run } from "@pe/ducts-web/ducts/legs";
import { labelOfNode, legsOf } from "@pe/ducts-web/ducts/legs";
import type { Split } from "../loss-split.ts";
import { activeName, namesOf, systemCode } from "@pe/ducts-web/ducts/identity";
import { DuctsOverlay, linesOf, useEquipment } from "@pe/ducts-web/ducts/picture-content";
import { indexOf, sceneOf, subjectScene } from "@pe/ducts-web/ducts/scene";
import { Schematic } from "@pe/ducts-web/ducts/schematic";
import { paintOfDucts, stubIdsOf } from "@pe/ducts-web/ducts/selection";
import { stubLabels } from "@pe/ducts-web/ducts/stub-labels";
import { noRunParts } from "@pe/ducts-web/ducts/subject-text";
import type { systemList } from "../system-list.ts";
import type { SystemNote } from "../system-list-search.ts";
import type { LossesWork } from "@pe/ducts-web/ducts/work";
import { EncodingPicker } from "@pe/ducts-web/ducts/encoding/picker";
import { ScaleLegend } from "@pe/ducts-web/ducts/encoding/scale-legend";
import type { GroupEncoding } from "@pe/ducts-web/ducts/encoding/use-encoding";
import { BarPopover, fmtFt, SystemMark, systemNoteCount } from "./bar.tsx";
import { GoToSubject } from "@pe/ducts-web/ducts/screen/go-to";
import { RulingBody, useMarks } from "./rulings.tsx";
import { RunDetail, runOf } from "./run-detail.tsx";

export { DUCTS_FLAT, DUCTS_LAYER_OPTIONS } from "@pe/ducts-web/ducts/picture-options";
import { DUCTS_FLAT, DUCTS_LAYER_OPTIONS } from "@pe/ducts-web/ducts/picture-options";


import { issueOf, issueSubject } from "@pe/ducts-web/ducts/cell-focus";

type PictureContext = DuctsDrawContext;
interface DuctsPictureProps {
  ctx: PictureContext;
  snapshot: DuctSnapshot | null;
  /** The network read's model revision and whether it is current: what the capture follows. Pricing
   * withdraws action authority, but does not invalidate current native geometry. */
  source: { version: string; current: boolean };
  priced: Priced | null;
  analysis: import("@pe/agent-contracts").DuctsPricingData["analysis"] | null;
  subject: Run | null;
  work: LossesWork;
}

const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));
/** A tree group lights under an element hovered in 3D; an issue's set does not. */
const hoverGroups = (group: SubjectKey) => !group.startsWith("issue:");

export interface DuctsPictureExtra {
  /** The kernel pane's draw: these parts over its picture. */
  picture(parts: PictureParts): ReactNode;
  issues: readonly StageIssue[];
  /** The open systems' groups (stable, `scopeOf`); the picture draws every one. */
  groups: readonly string[];
  members?: ReadonlySet<number>;
  /** Issue rows and tree nodes to their elements: the picture registers them on attention. */
  membership: Members;
  /** The networks one unit away (`neighboursOf`): their stubs join the capture, painted `stub`. */
  neighbours: readonly Neighbour[];
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
    /** `partial` says how many of the document's systems are read when the read is by system. */
    census: { systems: number; priced: number; fix: number; partial?: string | null };
    refreshing: boolean;
    /** Opens the system's tree, where its issues stand. */
    open: () => void;
    /** The critical run's loss groups under the ESP, with the system's fans at its head. */
    breakdown: { split: Split; scale: number; fans: () => ReactNode } | null;
  };
  /** The screen's alias picks call this when the subject is already the selection: fly again. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}

/** Only opened systems are captured; an unscoped page never captures the whole document. */
export const ductsFocus = (
  snapshot: DuctSnapshot | null,
  system: readonly string[],
  drawn: Iterable<number> = [],
  stubs: Iterable<number> = [],
) => {
  if (!snapshot) return null;
  const scope = scopeOf(snapshot, system);
  if (!scope) return null;
  return {
    walked: [...new Set([...scope.members, ...drawn])],
    near: [...stubs],
  };
};

function rulingIssue(r: Ruling, issues: readonly StageIssue[]) {
  const finding =
    r.kind === "issue" ? r.issue.id : r.finding.id;
  return issues.find((issue) => issue.findings.includes(finding))?.key ?? finding;
}

export function DuctsPicture(props: DuctsPictureProps & DuctsPictureExtra) {
  const { snapshot } = props;
  if (!snapshot) {
    const read = props.ctx.read(network);
    return "value" in read ? <p className="p-3 text-ink-2">No snapshot</p> : props.ctx.absent(read);
  }
  // Route UI stays retained; capture buffers, clipped meshes and layer descriptors do not.
  return (
    <VisibleRouteResource>
      <Content {...props} snapshot={snapshot} />
    </VisibleRouteResource>
  );
}

function Content({
  picture,
  snapshot,
  source,
  priced,
  analysis,
  ctx,
  subject,
  work,
  issueScope,
  annotated,
  issues,
  groups,
  members,
  membership,
  neighbours,
  scale,
  nameOf,
  identity,
  jump,
}: DuctsPictureProps & DuctsPictureExtra & { snapshot: DuctSnapshot }) {
  const authored = ctx.page.read();
  const openedSystems = namesOf(authored.system);
  const page = {
    ...authored,
    system: openedSystems === "all" ? snapshot.systems.map((row) => row.name) : openedSystems,
    active: activeName(
      authored.system,
      snapshot.systems.map((row) => row.name),
    ),
    selected: authored.selected.map((item) => item.id).join(","),
  };
  const select = (selected: string) =>
    ctx.page.select(selected ? [{ kind: "focus", id: selected }] : []);
  const pickIssue = (issue: string) => {
    select(issueSubject(issue));
    ctx.page.query({ rulingSearch: emptyListSearch() });
  };
  const index = useMemo(() => indexOf(snapshot, priced), [snapshot, priced]);
  const door = useAdmittedSubject();
  const elements = useMemo(() => ductElements(snapshot), [snapshot]);
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
    // No system open: the equipment overview, as context the picture captures from its focus.
    () =>
      ductsFocus(snapshot, page.system, members, stubs) ?? {
        walked: [],
        near: snapshot.nodes.filter((node) => node.kind === "equipment").map((node) => node.id),
      },
    [snapshot, page.system, members, stubs],
  );
  const on = layersOn(page.layers, DUCTS_LAYER_OPTIONS);
  const systemColours = on.includes("system-colours");
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
    }),
    [meshCuts],
  );
  const lines = useMemo(() => linesOf(scene, elements), [scene, elements]);

  const sub = scene.subject ?? null;
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);

  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point ?? null;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const { rulings, labels, cumulative } = useMarks({
    heal: analysis?.heal ?? null,
    snapshot,
    priced,
    scene,
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
            runsOf(priced.calcs),
            scopeOf(priced.snapshot, page.system)!,
            priced.flows,
          )
        : new Map(),
    [priced, page.system],
  );
  const heal3d: Layer3D[] = [];
  const reviewTargets = new Set<number>();
  const findings3d = useMemo(
    () =>
      findingLayers(
        findingShapes(
          snapshot,
          annotated,
          work.doc,
          scope?.members,
          analysis?.heal.groups.flatMap((group) => group.items) ?? [],
          analysis?.inference ?? { joints: [], taps: [], inline: [], findings: [] },
        ),
        issues,
      ),
    [snapshot, annotated, work.doc, scope, issues, analysis],
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
        draw: ({ meshes }) => [...findings3d, ...heal3d, ...damageOf(meshes)],
      },
      ports,
    ],
    [noRuns3d, findings3d, heal3d, damageOf, ports],
  );

  // Header facts: a system name (never a group id), Pe fan static, critical run total.
  const firstId = subject?.ids[0] ?? scene.segments[0]?.segment.id ?? null;
  const systemName =
    (page.system.join(" + ") || null) ??
    (firstId == null
      ? null
      : (byId.segments.get(firstId)?.systemName ?? byId.nodes.get(firstId)?.systemName)) ??
    null;
  const active = page.active;
  const activeScope = priced && active ? systemScope(priced.snapshot, active) : null;
  const worst = priced && activeScope ? worstRun(priced.calcs, activeScope.terminals) : null;
  // The system's fans, each on its own calc. One complete calc states the ESP; several never sum
  // and none owns the network (MAP invariant 6), so the readout sends the reader to each fan.
  const fans = priced && activeScope ? fanFacts(priced, activeScope) : null;
  const solved = fans && {
    fans,
    fan: fans.length === 1 && fans[0]?.complete ? fans[0].esp : null,
    critical: worst?.terminal ?? null,
    criticalTel: worst?.tel ?? null,
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
    select(id == null ? "" : (elements.keyOf(id) ?? ""));
  };
  const widen = useMemo(
    () =>
      sub
        ? (key: SubjectKey) => elements.keysOf(sub.legOf.get(elements.idOf(key))?.ids ?? [])
        : undefined,
    [sub, elements],
  );

  const ruling = (r: Ruling) => {
    const issue = rulingIssue(r, issues);
    pickIssue(issue);
  };
  const schematic = (size: "main" | "inset", readout: ReactNode = null) => (
    <Schematic
      index={index}
      groups={groups}
      members={members}
      targets={reviewTargets}
      encoding={scale.encoding}
      onSelect={(id) => pick(id)}
      size={size}
      readout={readout}
    />
  );

  const ruled = rulings.find((r) => rulingIssue(r, issues) === page.selected) ?? null;
  const subjects = useContext(SubjectTextContext);
  const systemState = identity.system
    ? systemNoteCount(identity.system, identity.system.note)
    : { issues: [], total: 0 };
  const facts = (key: SubjectKey) => {
    const readId = elements.idOf(key);
    const segFacts = scene.segments.find((f) => f.segment.id === readId);
    const nodeFacts = scene.nodes.find((f) => f.node.id === readId);
    // How Pe prices the selection's run (was the sidebar's run detail; selection lives here now).
    const run = priced && scope ? runOf(priced, readId) : null;
    return (
      <>
        {ruled && ruled.at === readId ? <RulingBody r={ruled} /> : null}
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
        {identity.census.partial ? ` · ${identity.census.partial}` : null}
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
        {!solved ? (
          <span>not priced</span>
        ) : !solved.fans.length ? (
          <span className="text-ink-2" data-readout-missing="">
            Rule a fan to price this system
          </span>
        ) : solved.fan == null ? (
          <span data-tone={solved.fans.length > 1 ? undefined : "alarm"} data-readout-missing="">
            {solved.fans.length > 1
              ? "Shared network; read pressure per fan"
              : `no ESP: this ${solved.fans[0]?.role}`}
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
            ) : null}
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
  const marksOn = new Set<string>(on);
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
        ...(marksOn.has("findings") ? [...findings3d, ...heal3d, ...damageOf(frame.meshes)] : []),
      ]}
      issues={issues}
      pointOf={pointOf}
      issue={issueOf(page.selected)}
      onRuling={ruling}
    />
  );

  return picture({
        source,
        label: page.system.join(", "),
        jump,
        focus,
        members: membership,
        hoverGroups,
        widen,
        capture,
        lines,
        name: (key) => nameOf(elements.idOf(key)),
        paint,
        kinds,
        colour,
        layers,
        layerOptions: DUCTS_LAYER_OPTIONS,
        overlay,
        readout: {
          subject: systemName ?? undefined,
          summary: <>{summary}</>,
          idle,
          facts,
        },
        flat: { ...DUCTS_FLAT, render: schematic },
        goTo: (jumpTo) => (
          <GoToSubject
            snapshot={snapshot}
            here={scope?.members ?? new Set()}
            opens={(system) => !page.system.includes(system)}
            nameOf={nameOf}
            onGo={({ system, id }) => {
              const key = id == null ? null : elements.keyOf(id);
              if (id == null) door?.add([systemCode(system)]);
              else if (key) jumpTo(key);
            }}
          />
        ),
        furniture: {
          title: "Systems",
          actions: (
            <EncodingPicker
              value={scale.encoding.key}
              onPick={(key) => ctx.page.pose({ encoding: key }, "named")}
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
        onIssuePick: (target) => pickIssue(target.key),
  });
}
