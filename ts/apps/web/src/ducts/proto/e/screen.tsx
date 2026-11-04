import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
} from "react";

import { survey, unitFlowsIn } from "@pe/ducts-domain/survey";
import { healPlan } from "@pe/ducts-domain/heal";
import { fansOwedBase, type OwedBase } from "@pe/ducts-domain/fan-assignment";
import { sectionsOf } from "@pe/ducts-domain/system-scope";
import { neighboursOf, type Neighbour } from "@pe/ducts-domain/neighbours";
import { systemSearch } from "@pe/ducts-domain/system-search";
import { useList, emptyListState, type ListOptions } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";

import { airflowOptions } from "../../airflow";
import { noRunParts, subjectNamer } from "../../subject-text";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { AttentionRoot, useHoveredIssue } from "#/attention";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import {
  annotatedFindings,
  stageIssues,
  fanVerbs,
  focusRow,
  inboxRows,
  type CellRef,
  type InboxItem,
} from "../../inbox-rows";
import { groupLabels } from "@pe/ducts-domain/words";
import { scopeOf, systemScope } from "@pe/ducts-domain/system-scope";
import { stagedEsp } from "@pe/ducts-domain/staged";

import type { LossesWork } from "../../work";

import { buildTree, type TreeNode } from "../b/model";
import type { systemList } from "../../system-list";
import type { SystemNote } from "../../system-list-search";
import { useProtoPage, type ProtoProps } from "../props";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { BarRules, systemNoteCount, systemRowParts } from "./bar";

import { DesignFriction } from "./design-friction";
import { ParameterSlots, SystemColours } from "./settings";
import { FanFacts, fanFacts, type FanFact } from "./fan-sections";
import { DuctsPicture } from "./picture";
import { grilleLabels } from "./labels";
import { FanButton, Inbox, type FanVerbs } from "./inbox";
import type { WriteVerbs } from "./inbox-write";
import { InputsPane } from "./inputs-pane";
import { RulesTree, ruleOfIds } from "./rules-pane";
import { SystemTree } from "./tree-sidebar";
import { useGroupEncoding } from "../encoding/use-encoding";

import { EMPTY_SNAPSHOT } from "../../sheet/scoped-snapshot";
import { LoadingContext } from "#/route/loading-context";
import { DUCTS_MULTI } from "../../selection";
import { useAdmittedSubject } from "#/shell/subject";
import { PaneActions } from "#/shell/pane-actions";
import { subscribe as knobsChanged } from "#/knobs/knobs";

import { settleWork } from "#/shell/work-door-observation";
import * as Atom from "effect/reactivity/Atom";
import {
  stagedDucts,
  ductsDesign,
  neutralFansWork,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { pendingCount } from "@pe/ducts-domain/staged";
import type { PaneContext } from "../../../../../../packages/agent-contracts/src/route-kernel-bodies";
import {
  activeName,
  ductsData,
  schemas,
  entries,
  localId,
  localSubject,
  namesOf,
} from "../../neutral";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { DuctsOwner, commands } from "../../pane-context";
import { claimsOf, type Claim } from "../../legs";
import { verdictPatches } from "../../claims";
import { rememberAnalysis, type PricingResult } from "../../pricing-job";
import type { EditMeta } from "../../sheet/input-history";
import { systemReadCoverage } from "../../system-reads";
import { Button } from "@pe/kit/lang/button";
import { healTarget, offeredFan } from "@pe/ducts-domain/action-targets";
import { elementNamer } from "../../claims";

type NetworkContext = PaneContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  keyof typeof ductsData.panes
>;

export function NetworkBody({
  ctx,
  id,
}: {
  ctx: NetworkContext;
  id: keyof typeof ductsData.panes;
}) {
  // U4 wires the real fans Work here.
  const workDoc = useMemo(() => ductsDesign(ctx.work, neutralFansWork), [ctx.work]);
  const target = ctx.workBasis?.token.scope.identity.target ?? { kind: "host" as const };
  const authored = ctx.page.read();
  const roster = ctx.readings.roster.value;
  const system = namesOf(authored.system);
  // readonly at the contract owner after U2 lands; U1b removes the remaining picture Page shape.
  const page = {
    ...authored,
    stage: "network",
    system: system === "all" ? (roster?.systems ?? []).map((system) => system.name) : system,
    active: activeName(
      authored.system,
      (roster?.systems ?? []).map((system) => system.name),
    ),
    fan: namesOf(authored.fan),
    selected: authored.selected.map((item) => localSubject(item.id)).join(","),
    heal: null,
  } as ProtoProps["page"];
  const doc = target.kind === "document" ? target.ref : null;
  const networkRead = ctx.readings.ducts;
  // Domain readonly sweep reached 28 files; snapshot consumers still require mutable arrays.
  const snapshot = (networkRead.value ?? null) as import("../../neutral").SnapshotReading | null;
  const pricing = ctx.readings.pricing;
  // Kernel gap: the pricing derive schema is unknown; its worker result also carries Maps.
  const priced =
    pricing.status !== "failed" ? (pricing.value as PricingResult | undefined) : undefined;
  const edit = useMemo(() => stagedDucts(workDoc ?? null, workDoc ?? neutralFansWork), [workDoc]);
  const seen = useMemo(
    () => withStoredRulings(workDoc ?? null, snapshot?.store),
    [workDoc, snapshot],
  );
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "ducts:unbound";
  const selection = useMemo(
    () =>
      Atom.make<ReadonlySet<SubjectKey>>(
        new Set<SubjectKey>(
          authored.selected.map(({ id }): SubjectKey => {
            const name = localSubject(id);
            if (/^\d+$/.test(name)) return elementKey(name);
            const colon = name.indexOf(":");
            return colon < 0 ? `issue:${name}` : `${name.slice(0, colon)}:${name.slice(colon + 1)}`;
          }),
        ),
      ),
    [authored.selected],
  );
  const setPage = useProtoPage(ctx.page, ctx.verbs.browse);
  const write = useCallback(
    async (patches: RouteStatePatch[], history?: EditMeta) => {
      if (!ctx.workBasis)
        return { code: "unavailable", message: "Read this document's Work before editing" };
      const result = await settleWork(ctx.verbs.edit({ patches, history }, ctx.workBasis));
      return result.kind === "refused" ? { code: "refused", message: result.refusal.error } : null;
    },
    [ctx],
  );
  const onVerdict = useCallback(
    (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => {
      void write(verdictPatches(workDoc, claim, verdict));
    },
    [workDoc, write],
  );
  const claimCells = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(workDoc?.claims ?? {}).flatMap(([id, cell]) => {
          const value = cell.edit?.value ?? cell.suggestion?.value;
          return value ? [[id, value]] : [];
        }),
      ),
    [workDoc],
  );
  const scope = useMemo(
    () => (snapshot ? scopeOf(snapshot, page.system) : null),
    [snapshot, page.system],
  );
  const claims = useMemo(
    () => claimsOf(scope ? claimsForGroup(claimCells, [...scope.members]) : claimCells),
    [scope, claimCells],
  );
  const subjectIds = scope?.groups
    .map((group) => edit.subject[group] ?? workDoc?.subject[group]?.suggestion?.value)
    .find((ids) => ids != null);
  const current = networkRead.current;
  const version = snapshot?.sourceVersion;
  const observation = useMemo<NativeObservation>(
    () => ({
      scope: { document: current ? doc : null, source: "native" },
      references: [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].map((element) => ({
        elementId: element.id,
        uniqueId: element.uniqueId,
      })),
    }),
    [current, doc?.session, doc?.openId, snapshot],
  );
  // Install the worker's exact analysis before any pane asks cached domain projections for it.
  if (
    priced &&
    snapshot &&
    pricing.current &&
    ctx.readings.tables.value &&
    ctx.readings.catalogs.value
  ) {
    const grids = ctx.readings.tables.value;
    const catalog = ctx.readings.catalogs.value;
    rememberAnalysis(
      {
        snapshot,
        grids: grids!,
        catalogs: catalog!.tables,
        doc: workDoc ?? null,
      },
      priced,
    );
  }
  // Domain readonly sweep reached 28 files; coverage still accepts the mutable snapshot alias.
  const coverage = roster
    ? systemReadCoverage(snapshot, roster as import("@pe/ducts-domain/types").DuctSnapshot)
    : null;
  const stageScope = async (row: {
    kind?: string;
    group?: string;
    unitId?: number;
    systemId?: number;
  }) => {
    if (!ctx.workBasis || !snapshot) return;
    const active = page.active;
    switch (row.kind) {
      case "price": {
        const groups = active ? systemScope(snapshot, active).groups : [];
        if (groups.length) return ctx.verbs.scope({ groups: [...groups] }, ctx.workBasis);
        return;
      }
      case "heal":
      case "heal-preview": {
        const group = row.group ?? healTarget(snapshot, workDoc, active, page.selected, null);
        if (active && systemScope(snapshot, active).groups.includes(group))
          return ctx.verbs.scope({ groups: [group] }, ctx.workBasis);
        return;
      }
      case "assign-fan": {
        const fan =
          row.unitId != null && row.systemId != null
            ? { unitId: row.unitId, systemId: row.systemId }
            : offeredFan(
                snapshot,
                workDoc,
                ctx.readings.tables.value ?? {},
                ctx.readings.catalogs.value?.tables ?? {},
                active,
                page.selected,
                null,
                elementNamer(snapshot, null),
              );
        if (snapshot.systems.find((system) => system.id === fan.systemId)?.name === active)
          return ctx.verbs.scope({ fan }, ctx.workBasis);
        return;
      }
    }
  };
  const scopeCommand = (row?: unknown) => {
    const choice = row as
      | { kind?: string; group?: string; unitId?: number; systemId?: number }
      | undefined;
    return choice?.kind && ["price", "heal", "heal-preview", "assign-fan"].includes(choice.kind) ? (
      <Button
        label="Choose write scope"
        onClick={() => {
          void stageScope(choice);
        }}
      >
        Choose write scope
      </Button>
    ) : null;
  };
  const props: ProtoProps = {
    attentionDoc,
    selection,
    snapshot,
    priced: priced?.priced ?? null,
    pricing: !!snapshot?.groups.length && !priced && pricing.status === "pending",
    analysis: priced?.analysis ?? null,
    subject: subjectIds ? { ids: subjectIds, claims, work: workDoc ?? null, onVerdict } : null,
    claims,
    onVerdict,
    page,
    setPage,
    onSelect: (id) => setPage({ selected: id == null ? "" : String(id) }),
    work: {
      doc: seen,
      revision: ctx.workBasis?.workRevision ?? null,
      write: (patches) => write(patches),
    },
    empty: !doc
      ? { says: "No document bound", exit: "Choose an open project document" }
      : !snapshot
        ? { says: "Reading ducts", exit: "Wait for this document's snapshot" }
        : null,
    doc,
    // Fan overview depends on the roster, not the optional sheet detail reads.
    captureSource: networkRead.current && doc && version ? { document: doc, version } : null,
    reading: {
      pending: networkRead.status === "pending",
      error:
        (ctx.readings.roster.status === "failed" ? "System roster failed" : null) ??
        (networkRead.status === "failed" ? networkRead.reason : null) ??
        (ctx.readings.tables.status === "failed" ? "Tables failed" : null) ??
        (ctx.readings.catalogs.status === "failed" ? "Catalogs failed" : null) ??
        (pricing.status === "failed" ? pricing.reason : null) ??
        null,
      refreshing:
        (!networkRead.current || (pricing.status !== "failed" && !pricing.current)) && !!snapshot,
    },
    commands,
    cells: commands,
    edit: pendingCount(workDoc ?? null, snapshot?.store),
    coverage: coverage
      ? {
          ...coverage,
          reading: networkRead.status === "pending" ? page.system : [],
        }
      : null,
  };

  const subjectProps = useRevitSubjectProps();
  const fanRead = ctx.readings.fans;
  return (
    <DuctsOwner
      value={{
        selected: page.selected,
        cells: ctx.cells,
        select: (selected) => setPage({ selected }),
        commands: scopeCommand,
        fanRoster: fanRead.value?.rows ?? [],
      }}
    >
      <NativeObservationScope value={observation}>
        <AttentionRoot doc={props.attentionDoc}>
          <SubjectTextContext.Provider value={{doc: props.attentionDoc, nameOf: subjectNamer(props.snapshot ?? EMPTY_SNAPSHOT), go: props.onSelect, refProps: subjectProps}}>
            {(!snapshot || props.pricing) && <LoadingContext name={ductsData.panes[id].label} says={props.empty?.says ?? 'Pricing ducts...'} error={props.reading.error} busy={props.reading.pending || props.pricing}>{null}</LoadingContext>}
            <NetworkPane id={id} props={props} />
          </SubjectTextContext.Provider>
        </AttentionRoot>
      </NativeObservationScope>
    </DuctsOwner>
  );
}

const NO_GROUPS: readonly string[] = [];
const NO_NEIGHBOURS: readonly Neighbour[] = [];
/** The open list as one string: what a hold, a side and a list scope key on. */
const openKey = (open: readonly string[]) => open.join(", ");
const NO_NOTES: ReadonlyMap<string, SystemNote> = new Map();
const NO_SYSTEMS: ReturnType<typeof systemList> = [];



function NetworkPane({id, props}: {id: keyof typeof ductsData.panes; props: ProtoProps}) {
 const input = {...props, snapshot: props.snapshot ?? EMPTY_SNAPSHOT};
 switch(id) {
  case 'e-systems': return <SystemsPane props={input}/>;
  case 'e-sidebar': return <TreePane props={input}/>;
  case 'e-inputs': return <InputsBody props={input}/>;
  case 'e-rules': return <RulesBody props={input} wide={false}/>;
  case 'e-rules-all': return <RulesBody props={input} wide/>;
  case 'e-picture': return <PictureBody props={input}/>;
  case 'e-inbox': return <InboxBody props={input}/>;
 }
}

/** "n of m systems read", or null when the snapshot holds every system. */
const partialWord = (coverage: ProtoProps["coverage"]) =>
  coverage && coverage.read < coverage.of
    ? `${coverage.read} of ${coverage.of} systems read`
    : null;

/**
 * The systems list's empty state from the same coverage the read line counts: systems the
 * document holds but this read has not reached are "not read", never "none in scope".
 */
export const systemsEmpty = (coverage: ProtoProps["coverage"]) =>
  coverage && coverage.of > 0 && coverage.read === 0
    ? { message: `None of ${coverage.of} systems read yet`, exit: "Choose systems in Open systems" }
    : { message: "No duct systems in this scope", exit: "Read a model containing duct systems" };

/** The scoped read's extent. */
function ReadCoverage({ coverage }: { coverage: ProtoProps["coverage"] }) {
  const partial = partialWord(coverage);
  if (!coverage || (!partial && !coverage.report)) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-2 t-small text-ink-2" data-e-coverage="">
      <span>
        {partial ?? `${coverage.read} of ${coverage.of} systems read`}
        {coverage.reading.length ? ` · reading ${coverage.reading.join(", ")}…` : ""}
        {coverage.report ? ` · ${coverage.report}` : ""}
      </span>
    </p>
  );
}


function SystemsPane({props}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}}) {
const { snapshot, priced, page, setPage } = props;
const doc = props.work.doc;
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const active = page.active;
const groups = scope?.groups ?? NO_GROUPS;
const systems = props.analysis?.systems ?? NO_SYSTEMS;
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const notes = props.analysis?.notes ?? NO_NOTES;
const { system, systemSearch, systemSort } = page;
const version = props.captureSource?.version ?? "";
const systemKeys = ({ version, system, active, systemSearch, systemSort });
const fansOf = useCallback((system: ReturnType<typeof systemList>[number]) => fanFacts(priced, system.groups, nameOf, drawn ? systemScope(drawn, system.name).terminals : undefined), [priced, nameOf, drawn]);
const systemsPane = (<>
        <ReadCoverage coverage={props.coverage}/>
        {props.reading.error ? (<p role="alert" data-tone="alarm">
            {props.reading.error}
          </p>) : null}
        <Scroll className="min-h-0 flex-1">
          <SystemsList systems={systems} fansOf={fansOf} nameOf={nameOf} notes={notes} drawn={drawn} page={systemKeys} setPage={setPage} coverage={props.coverage}/>
        </Scroll>
      </>);
return <BarRules snapshot={drawn} work={props.work} priced={priced}>{systemsPane}</BarRules>;
}

function TreePane({props}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}}) {
const { snapshot, priced, page, setPage } = props;
const doc = props.work.doc;
const ruleOf = ruleOfIds(priced);
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const groups = scope?.groups ?? NO_GROUPS;
const displayMembers = scope && snapshot
    ? new Set([...scope.members, ...scopeOf(snapshot, page.system)!.members])
    : undefined;
const drawGroups = (() => {
    const raw = snapshot ? scopeOf(snapshot, page.system)?.groups : undefined;
    if (!raw)
        return groups;
    const merged = [...snapshot.nodes, ...snapshot.segments].flatMap((e) => e.groupId && scope?.members.has(e.id) ? [e.groupId] : []);
    return [...new Set([...groups, ...raw, ...merged])];
})();
const multi = useSyncExternalStore(knobsChanged, DUCTS_MULTI.read, DUCTS_MULTI.read).selection;
const neighbours = (snapshot && scope ? neighboursOf(snapshot, displayMembers!, multi) : NO_NEIGHBOURS);
const connected = (() => {
    const shown = new Set(page.system);
    const via = new Map<string, number[]>();
    for (const n of neighbours)
        for (const system of n.systems)
            if (!shown.has(system) && !via.get(system)?.includes(n.unit))
                via.set(system, [...(via.get(system) ?? []), n.unit]);
    return [...via].map(([system, units]) => ({ system, units }));
})();
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const encoded = useGroupEncoding(snapshot, priced, drawGroups, page.encoding);
const reading = encoded.encoding.quantity ? encoded.encoding : null;
const grilleName = useCallback((n: TreeNode) => {
    const id = n.kind === "run" ? n.terminal : n.id;
    return (id != null ? labels.get(id) : undefined) ?? n.name;
}, [labels]);
const jumpToRule = (key: string) => setPage({selected: `rule:${key}`});
const tree = trees.length ? trees : null;
const select = props.onSelect;
const critical = tree
    ?.flatMap((t) => t.children)
    .filter((r) => r.terminal == null || !scope || scope.terminals.has(r.terminal))
    .reduce<TreeNode | null>((best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best), null) ?? null;
const scale = critical?.total ?? null;
const selected = page.selected && /^\d+$/.test(page.selected) ? Number(page.selected) : null;
const designRate = priced?.edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
const treePane = tree ? (<>
          <Scroll className="min-h-0 flex-1">
            <div className="min-w-0 shrink-0">
              <SystemTree key={scope?.name} address={{
        scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
        search: page.treeSearch,
        sort: page.treeSort,
        onChange: (treeSearch, treeSort) => setPage({ treeSearch, treeSort }, { history: "replace" }),
    }} ctx={{
        trees: tree,
        scale,
        criticalKey: critical?.key ?? null,
        grilleName,
        selected,
        ruleOf,
        select,
        jumpToRule,
        reading,
        designRate,
    }}/>
              {connected.length ? (<div data-e-connected="" className="flex flex-col items-start py-1">
                  <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">Connected</p>
                  {connected.map(({ system, units }) => (<span key={system} data-e-connected-system={system}>
                      {`${system} · via ${units.map(nameOf).join(", ")}`}
                    </span>))}
                </div>) : null}
            </div>
          </Scroll>
        </>) : null;
return treePane;
}

function InputsBody({props}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}}) {
const { snapshot, priced, page, setPage } = props;
const doc = props.work.doc;
const work: LossesWork = props.work;
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const active = page.active;
const groups = scope?.groups ?? NO_GROUPS;
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const surveyed = priced ?? (snapshot ? survey(snapshot, doc) : null);
const fanHandles: FanVerbs = { render: props.commands };
const owedBase: OwedBase = snapshot && surveyed
    ? fansOwedBase(snapshot, surveyed.roles, (g) => priced?.next.byGroup[g]?.fans[0]?.unit ?? null)
    : new Map();
const fanVerbsOf = useCallback((id: number) => {
    const verbs = (owedBase.get(id) ?? [])
        .filter((a) => a.system === active)
        .flatMap((a) => fanVerbs(a, nameOf));
    const split = [...(owedBase.split ?? [])].find(([system, units]) => system === active && units.includes(id));
    if (!verbs.length && split)
        return (<span className="t-small text-ink-2" data-e-fan-split={split[0]}>
            {`${split[0]} spans separate networks with their own fans (${split[1].map((u) => nameOf(u)).join(", ")}); Revit gives a system one fan, so split ${split[0]} in Revit first`}
          </span>);
    if (!verbs.length)
        return null;
    return (<span className="flex flex-wrap items-baseline gap-1" data-e-fan-verbs={id} onClick={(event) => event.stopPropagation()}>
          {verbs.map((v) => (<FanButton key={v.on.verb === "fan" ? v.on.systemId : v.label} verb={v} fan={fanHandles}/>))}
        </span>);
}, [owedBase, active, nameOf, fanHandles]);
const tree = trees.length ? trees : null;
const select = props.onSelect;
const selected = page.selected && /^\d+$/.test(page.selected) ? Number(page.selected) : null;
const inputsPane = tree && scope ? (<>
          <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">flow · ESP · role · drop</p>
          <InputsPane address={{
        scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
        search: page.inputSearch,
        sort: page.inputSort,
        onChange: (inputSearch, inputSort) => setPage({ inputSearch, inputSort }, { history: "replace" }),
    }} fanVerbs={fanVerbsOf} snapshot={drawn ?? snapshot} priced={priced} work={work} scope={scope} nameOf={nameOf} selected={selected} select={select}/>
        </>) : null;
return <><DesignFriction work={work} rate={priced?.edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE}/><ParameterSlots work={work} snapshot={snapshot} scope={scope}/><SystemColours work={work}/>{inputsPane}</>;
}

function InboxBody({props}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}}) {
const { snapshot, priced, page, setPage } = props;
const doc = props.work.doc;
const work: LossesWork = props.work;
const inboxWork = ({
    doc,
    revision: props.work.revision,
    write: work.write,
    store: snapshot?.store ?? null,
});
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const groups = scope?.groups ?? NO_GROUPS;
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const names = (drawn ? groupLabels(drawn) : new Map<string, string>());
const groupLabel = useCallback((g: string) => (sections.has(g) ? sectionOf(g) : (names.get(g) ?? "a duct network")), [sections, sectionOf, names]);
const surveyed = priced ?? (snapshot ? survey(snapshot, doc) : null);
const heal = (snapshot ? healPlan(snapshot, doc) : null);
const noRunRows: InboxItem[] = (() => {
    if (!priced || !scope)
        return [];
    return [
        ...new Set(noRunBranches(priced.snapshot, priced.next, scope, priced.flows).values()),
    ].map((branch) => ({
        key: `no-run:${branch.elements[0]}`,
        group: "diagnostics",
        kind: "no-run",
        title: "Branch with no run",
        status: "outside priced paths",
        ids: branch.elements,
        note: branch.reasons.map((r) => r.text).join("; "),
        parts: [
            "Branch ",
            { id: branch.elements[0]! },
            " has no run. ",
            ...noRunParts(branch, priced.snapshot),
            ...priced.findings
                .filter((f) => f.kind === "missed-join" &&
                f.elementIds.some((id) => branch.reasons.some((r) => r.at === id)))
                .flatMap((f) => [". ", f.note]),
        ],
        verbs: [{ kind: "select", ids: branch.elements }],
    }));
})();
const baseInbox = surveyed
    ? inboxRows({
        snapshot: surveyed.snapshot,
        scope,
        findings: surveyed.findings,
        flows: surveyed.flows,
        equipmentFlows: unitFlowsIn(surveyed, scope?.groups ?? null),
        doc,
        nameOf,
        groupLabel,
        heal,
        airflow: airflowOptions(surveyed.snapshot, scope),
        unitAirflow: airflowOptions(surveyed.snapshot, scope, "unit"),
        roles: surveyed.roles,
        claims: props.claims,
        write: {
            edit: props.edit,
            esp: stagedEsp(doc),
        },
    })
    : null;
const inbox = (() => {
    if (!baseInbox)
        return null;
    const run = page.heal;
    const reviewed = (row: InboxItem) => run && row.key === `heal:${run.group}`
        ? {
            ...row,
            status: run.sentence,
            note: run.rows.join("; "),
            ids: [...new Set([...row.ids, ...run.targets.flatMap((t) => t.ids)])],
        }
        : row;
    return {
        ...baseInbox,
        fix: baseInbox.fix.map(reviewed),
        diagnostics: [...baseInbox.diagnostics.map(reviewed), ...noRunRows],
    };
})();
const fanHandles: FanVerbs = { render: props.commands };
const selected = page.selected && /^\d+$/.test(page.selected) ? Number(page.selected) : null;
const select = props.onSelect;
const focusKey = inbox ? focusRow(page.selected, new Set([...inbox.fix,...inbox.set,...inbox.check,...inbox.diagnostics].map(row=>row.key))) : null;
const focusCell = (cell: CellRef) => {
 const rule = cell.segment === 'componentDrops' ? ruleOfIds(priced).get(cell.id) : undefined;
 setPage({selected: rule ? `rule:${rule}` : String(cell.id)});
};
const writeVerbs: WriteVerbs | null = inbox
    ? { control: props.commands({ kind: "price" }), row: inbox.write }
    : null;
const healHandles: FanVerbs = { render: props.commands };
const inboxPane = (<>
        {inbox ? (<ReachInbox groups={inbox} work={inboxWork} nameOf={nameOf} onVerdict={props.onVerdict} onSelect={select} onFocusCell={focusCell} write={writeVerbs!} heal={healHandles} fan={fanHandles} cells={props.cells} selected={selected} focused={focusKey} onPick={(issue) => setPage({ selected: issue }, { history: "push" })} address={{
            scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
            search: page.rulingSearch,
            sort: page.rulingSort,
            onChange: (rulingSearch, rulingSort) => setPage({ rulingSearch, rulingSort }, { history: "replace" }),
        }}/>) : null}
        {page.heal && (<section aria-label={page.heal.mode === "preview" ? "Heal preview" : "Heal result"} className="px-2 py-1">
            <p>{page.heal.sentence}</p>
            <ul>
              {page.heal.rows.map((row, index) => (<li key={index}>{row}</li>))}
            </ul>
          </section>)}
      </>);
return inboxPane;
}

function PictureBody({props}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}}) {
const { snapshot, priced, page } = props;
const doc = props.work.doc;
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const active = page.active;
const activeScope = (drawn && active ? systemScope(drawn, active) : null);
const groups = scope?.groups ?? NO_GROUPS;
const displayMembers = scope && snapshot
    ? new Set([...scope.members, ...scopeOf(snapshot, page.system)!.members])
    : undefined;
const drawGroups = (() => {
    const raw = snapshot ? scopeOf(snapshot, page.system)?.groups : undefined;
    if (!raw)
        return groups;
    const merged = [...snapshot.nodes, ...snapshot.segments].flatMap((e) => e.groupId && scope?.members.has(e.id) ? [e.groupId] : []);
    return [...new Set([...groups, ...raw, ...merged])];
})();
const multi = useSyncExternalStore(knobsChanged, DUCTS_MULTI.read, DUCTS_MULTI.read).selection;
const neighbours = (snapshot && scope ? neighboursOf(snapshot, displayMembers!, multi) : NO_NEIGHBOURS);
const systems = props.analysis?.systems ?? NO_SYSTEMS;
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const issueScope = drawn && scope
    ? new Set(drawn.groups.filter((g) => groups.includes(g.id)).flatMap((g) => g.issueIds))
    : null;
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const names = (drawn ? groupLabels(drawn) : new Map<string, string>());
const groupLabel = useCallback((g: string) => (sections.has(g) ? sectionOf(g) : (names.get(g) ?? "a duct network")), [sections, sectionOf, names]);
const surveyed = priced ?? (snapshot ? survey(snapshot, doc) : null);
const heal = (snapshot ? healPlan(snapshot, doc) : null);
const notes = props.analysis?.notes ?? NO_NOTES;
const partial = partialWord(props.coverage);
const census = (() => {
    const issues = systems.map((s) => systemNoteCount(s, notes.get(s.key)).issues);
    return {
        systems: systems.length,
        priced: systems.filter((s) => s.total != null).length,
        fix: issues.filter((i) => i.some((x) => x.tone === "alarm")).length,
        partial,
    };
})();
const chosenRow = (() => {
    const row = systems.find((s) => s.key === page.active);
    return row ? { ...row, note: notes.get(row.key) } : null;
})();
const noRunRows: InboxItem[] = (() => {
    if (!priced || !scope)
        return [];
    return [
        ...new Set(noRunBranches(priced.snapshot, priced.next, scope, priced.flows).values()),
    ].map((branch) => ({
        key: `no-run:${branch.elements[0]}`,
        group: "diagnostics",
        kind: "no-run",
        title: "Branch with no run",
        status: "outside priced paths",
        ids: branch.elements,
        note: branch.reasons.map((r) => r.text).join("; "),
        parts: [
            "Branch ",
            { id: branch.elements[0]! },
            " has no run. ",
            ...noRunParts(branch, priced.snapshot),
            ...priced.findings
                .filter((f) => f.kind === "missed-join" &&
                f.elementIds.some((id) => branch.reasons.some((r) => r.at === id)))
                .flatMap((f) => [". ", f.note]),
        ],
        verbs: [{ kind: "select", ids: branch.elements }],
    }));
})();
const baseInbox = surveyed
    ? inboxRows({
        snapshot: surveyed.snapshot,
        scope,
        findings: surveyed.findings,
        flows: surveyed.flows,
        equipmentFlows: unitFlowsIn(surveyed, scope?.groups ?? null),
        doc,
        nameOf,
        groupLabel,
        heal,
        airflow: airflowOptions(surveyed.snapshot, scope),
        unitAirflow: airflowOptions(surveyed.snapshot, scope, "unit"),
        roles: surveyed.roles,
        claims: props.claims,
        write: {
            edit: props.edit,
            esp: stagedEsp(doc),
        },
    })
    : null;
const inbox = (() => {
    if (!baseInbox)
        return null;
    const run = page.heal;
    const reviewed = (row: InboxItem) => run && row.key === `heal:${run.group}`
        ? {
            ...row,
            status: run.sentence,
            note: run.rows.join("; "),
            ids: [...new Set([...row.ids, ...run.targets.flatMap((t) => t.ids)])],
        }
        : row;
    return {
        ...baseInbox,
        fix: baseInbox.fix.map(reviewed),
        diagnostics: [...baseInbox.diagnostics.map(reviewed), ...noRunRows],
    };
})();
const encoded = useGroupEncoding(snapshot, priced, drawGroups, page.encoding);
const issues = (inbox ? stageIssues(inbox) : []);
const jump = useRef<((key: SubjectKey) => void) | null>(null);
const membership = (() => {
    const map = new Map<SubjectKey, readonly SubjectKey[]>();
    for (const issue of issues)
        map.set(`issue:${issue.key}`, issue.ids.map(elementKey));
    const walk = (node: TreeNode): number[] => {
        const ids = [
            ...new Set([...(node.id == null ? [] : [node.id]), ...node.children.flatMap(walk)]),
        ];
        if (node.kind !== "element")
            map.set(`${node.kind}:${node.key}`, ids.map(elementKey));
        return ids;
    };
    trees.forEach(walk);
    return map;
})();
const kindClause = page.rulingSearch.pills.find((pill) => pill.field === "kind" && pill.op === "=");
const diagnosticKind = kindClause?.value ?? "";
const annotated = (inbox ? annotatedFindings(inbox, heal, diagnosticKind) : new Set<string>());
const tree = trees.length ? trees : null;
const activeCritical = tree
    ?.flatMap((t) => t.children)
    .filter((r) => r.terminal != null && activeScope?.terminals.has(r.terminal))
    .reduce<TreeNode | null>((best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best), null) ?? null;
const leadGroup = activeScope?.groups.reduce<string | null>((best, g) => best == null ||
    (priced?.next.byGroup[g]?.fan ?? -Infinity) > (priced?.next.byGroup[best]?.fan ?? -Infinity)
    ? g
    : best, null) ?? "";
const picturePane = (<div className="relative flex size-full min-w-0 flex-col">
      {page.heal?.targets.some((target) => target.outcome === "planned" || target.outcome === "healed") && (<section aria-label="Heal targets" className="flex shrink-0 flex-col px-2 py-1 t-small">
          {page.heal.targets
            .filter((target) => target.outcome === "planned" || target.outcome === "healed")
            .map((target) => (<span key={target.key}>
                {target.how} · {target.end.replace(":", " end ")}
                {target.other ? ` to ${target.other.replace(":", " end ")}` : ""}
              </span>))}
        </section>)}
      <div className="relative min-h-0 flex-1">
        <DuctsPicture renderPane={(body, furniture) => (<>
              {body}
              <PaneActions pane="e-picture">{furniture?.actions}</PaneActions>
            </>)} {...props} membership={membership} issueScope={issueScope} annotated={annotated} issues={issues} scale={encoded} nameOf={nameOf} jump={jump} groups={drawGroups} members={displayMembers} neighbours={neighbours} lead={leadGroup} identity={{
        system: chosenRow,
        census,
        refreshing: props.reading.refreshing,
        open: () => { },
        breakdown: activeCritical?.split && activeCritical.total
            ? {
                split: activeCritical.split,
                scale: activeCritical.total,
                fans: () => (<FanFacts facts={fanFacts(priced, activeScope?.groups ?? [], nameOf, activeScope?.terminals)} nameOf={nameOf}/>),
            }
            : null,
    }}/>
      </div>
    </div>);
return picturePane;
}

function RulesBody({props, wide}: {props: ProtoProps & {snapshot: NonNullable<ProtoProps['snapshot']>}; wide: boolean}) {
const { snapshot, priced, page, setPage } = props;
const doc = props.work.doc;
const work: LossesWork = props.work;
const drawn = priced?.snapshot ?? snapshot;
const scope = (drawn ? scopeOf(drawn, page.system) : null);
const groups = scope?.groups ?? NO_GROUPS;
const sections = (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>());
const sectionOf = useCallback((g: string) => {
    const others = scope?.shared.get(g);
    const name = sections.get(g) ?? scope?.name ?? "";
    return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
}, [sections, scope]);
const trees = (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []);
const labels = drawn && trees.length
    ? grilleLabels(drawn, trees.flatMap((t) => t.children))
    : new Map<number, string>();
const subjectName = (snapshot ? subjectNamer(snapshot) : () => null);
const nameOf = useCallback((id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot", [labels, subjectName]);
const ruleFocus = page.selected.startsWith('rule:') ? page.selected.slice(5) : null;
const setRuleFocus = (key: string | null) => setPage({selected: key ? `rule:${key}` : ''});
const rulesPane = (<>
          {priced ? (<RulesTree snapshot={drawn ?? snapshot} priced={priced} groups={groups} wide={wide} work={work} focus={ruleFocus} onFocus={setRuleFocus} nameOf={nameOf}/>) : (<p className="text-ink-2 p-2">Loading rules</p>)}
        </>);
return rulesPane;
}

type SystemListItem = ReturnType<typeof systemList>[number];
const systemKey = (system: SystemListItem) => system.key;
const SYSTEM_SORTS = {
  name: (system: SystemListItem) => system.name,
  loss: (system: SystemListItem) => -(system.total ?? -Infinity),
};

/** Keep query renders below the model, drawing and ruling builders. */
// Memoized on the Page keys it reads: a selection or a camera move never re-renders 355 rows.
const SystemsList = memo(function SystemsList({
  systems,
  fansOf,
  nameOf,
  notes,
  drawn,
  page,
  setPage,
  coverage,
}: {
  systems: ReturnType<typeof systemList>;
  /** The system's fans: its hover hint and the head of its breakdown popover. */
  fansOf: (system: ReturnType<typeof systemList>[number]) => FanFact[];
  nameOf: (id: number) => string;
  notes: ReadonlyMap<string, SystemNote>;
  drawn: ProtoProps["snapshot"];
  page: Pick<ProtoProps["page"], "system" | "active" | "systemSearch" | "systemSort"> & {
    version: string;
  };
  setPage: ProtoProps["setPage"];
  coverage: ProtoProps["coverage"];
}) {
  const door = useAdmittedSubject();
  const systemId = (name: string) => localId("ducts-system", name);
  const searchable = useMemo(() => (drawn ? systemSearch(drawn) : null), [drawn]);
  const search = useCallback(
    (system: ReturnType<typeof systemList>[number]) => ({
      text: [system.name, system.sub, ...(searchable?.get(system.key)?.text ?? [])],
      ids: searchable?.get(system.key)?.ids,
    }),
    [searchable],
  );
  const fields = useMemo<NonNullable<ListOptions<SystemListItem>["fields"]>>(
    () => ({
      airType: {
        label: "Air type",
        kind: "text",
        read: (system) => system.classification,
        values: [
          ...new Set([
            "SupplyAir",
            "ReturnAir",
            "ExhaustAir",
            ...systems.flatMap((system) => system.classification ?? []),
          ]),
        ],
        labels: new Map([
          ["SupplyAir", "Supply"],
          ["ReturnAir", "Return"],
          ["ExhaustAir", "Exhaust"],
        ]),
      },
      status: {
        label: "Price status",
        kind: "text",
        read: (system) => (system.total == null ? "unpriced" : "priced"),
        values: ["priced", "unpriced"],
        labels: new Map([
          ["priced", "Priced"],
          ["unpriced", "Unpriced"],
        ]),
      },
      needsFix: {
        label: "Needs a fix",
        kind: "text",
        read: (system) => ((notes.get(system.key)?.fix ?? 0) > 0 ? "yes" : "no"),
        values: ["yes", "no"],
        labels: new Map([
          ["yes", "Yes"],
          ["no", "No"],
        ]),
      },
    }),
    [systems, notes],
  );
  const systemListView = useList({
    scope: page.version,
    items: systems,
    keyOf: systemKey,
    search,
    fields,
    sorts: SYSTEM_SORTS,
    state: {
      ...emptyListState<"name" | "loss">(),
      search: page.systemSearch,
      sort: page.systemSort,
      selected: [...page.system],
    },
    onState: (next) => {
      if (next.search !== page.systemSearch || next.sort !== page.systemSort)
        setPage({ systemSearch: next.search, systemSort: next.sort }, { history: "replace" });
    },
    onPick: (system) => door?.toggle(systemId(system.key)),
  });
  const active = page.active;
  useEffect(() => {
    if (systemListView.target && systemListView.rows.some((row) => row.key === active))
      systemListView.reveal(active);
    // The active system is revealed when its pane mounts; filtering never replaces the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, systemListView.target]);
  return (
    <ListView
      aria-label="systems"
      list={systemListView}
      row={(system) => {
        const fans = fansOf(system);
        return systemRowParts(
          system,
          () => door?.toggle(systemId(system.key)),
          notes.get(system.key),
          fans.map((f) => `${nameOf(f.unit)} ${f.role}: ${f.says}`),
          () => <FanFacts facts={fans} nameOf={nameOf} />,
        );
      }}
      projection={(system) => ({ weight: systemNoteCount(system, notes.get(system.key)).total })}
      empty={systemsEmpty(coverage)}
    />
  );
});

/** The inbox redraws only when the hovered issue (its rail) changes. */
function ReachInbox(props: Omit<ComponentProps<typeof Inbox>, "hoveredIssue">) {
  const issue = useHoveredIssue();
  return <Inbox {...props} hoveredIssue={issue} />;
}
