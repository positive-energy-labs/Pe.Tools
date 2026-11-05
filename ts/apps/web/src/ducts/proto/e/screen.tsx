import { useRouteSearchSlice } from "#/route/activity";
import { fansLink } from "../../../fans/neutral.ts";
import { AttentionRoot, useHoveredIssue } from "#/attention";
import { PointerCite } from "#/shell/pointer-list";
import { pointerRefs } from "../../pointer-refs";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { LoadingContext } from "#/route/loading-context";
import { PaneActions } from "#/shell/pane-actions";
import { useAdmittedSubject } from "#/shell/subject";
import { settleWork } from "#/shell/work-door-observation";
import {
  DUCT_UNIT_KINDS,
  ductsDesign,
  neutralFansWork,
  stagedDucts,
  cellPatches,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { suggestKind } from "@pe/ducts-domain/roster";
import { ChoiceCell } from "../../sheet/choice-cell.tsx";
import { kindMeaning, kindDisabledReason } from "../../sheet/kind-meaning.ts";
import { healTarget, offeredFan } from "@pe/ducts-domain/action-targets";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { healPlan } from "@pe/ducts-domain/heal";
import { neighboursOf, type Neighbour } from "@pe/ducts-domain/neighbours";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { pendingCount, stagedEsp } from "@pe/ducts-domain/staged";
import { survey, unitFlowsIn } from "@pe/ducts-domain/survey";
import { scopeOf, sectionsOf, systemScope } from "@pe/ducts-domain/system-scope";
import { systemSearch } from "@pe/ducts-domain/system-search";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { groupLabels } from "@pe/ducts-domain/words";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, type ListOptions } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { Scroll } from "@pe/kit/lang/scroll";
import * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { z } from "zod";
import type { PaneContext } from "../../../../../../packages/agent-contracts/src/route-kernel-bodies";
import { airflowOptions } from "../../airflow";
import { attentionSubjects, cellFocusOf, cellFocusSubject, focusedElement } from "../../cell-focus";
import { elementNamer, verdictPatches } from "../../claims";
import {
  annotatedFindings,
  focusRow,
  inboxRows,
  stageIssues,
  type InboxItem,
} from "../../inbox-rows";
import { claimsOf, type Claim } from "../../legs";
import {
  activeName,
  ductsData,
  entries,
  localId,
  localSubject,
  namesOf,
  schemas,
} from "../../neutral";
import { DuctsOwner, commands } from "../../pane-context";
import { type PricingResult } from "../../pricing-job";
import { DUCTS_MULTI } from "../../selection";
import type { EditMeta } from "../../sheet/input-history.neutral";
import { EMPTY_SNAPSHOT } from "../../sheet/scoped-snapshot";
import { noRunParts, subjectNamer } from "../../subject-text";
import type { systemList } from "../../system-list";
import type { SystemNote } from "../../system-list-search";
import { systemReadCoverage } from "../../system-reads";
import { buildTree, type TreeNode } from "../b/model";
import { useGroupEncoding } from "../encoding/use-encoding";
import { BarRules, systemNoteCount, systemRowParts } from "./bar";
import { FanFacts, fanFacts, type FanFact } from "./fan-sections";
import { Inbox, type FanVerbs } from "./inbox";
import { grilleLabels } from "./labels";
import { DuctsPicture } from "./picture";
import { RulesTree, ruleOfIds } from "./rules-pane";
import { SystemColours } from "./settings";
import { SystemTree } from "./tree-sidebar";
type NetworkContext = PaneContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  keyof typeof ductsData.panes
>;
function useNetworkData(ctx: NetworkContext) {
  const workDoc = useMemo(
    () => ductsDesign(ctx.work, ctx.readings.fansWork.value ?? neutralFansWork),
    [ctx.work, ctx.readings.fansWork.value],
  );
  const target = ctx.workBasis?.token.scope.identity.target ?? { kind: "host" as const };
  const page = ctx.page.read();
  const roster = ctx.readings.roster.value;
  const system = namesOf(page.system);
  const systems = useMemo(
    () => (system === "all" ? (roster?.systems ?? []).map((row) => row.name) : system),
    [page.system, roster],
  );
  const active = activeName(
    page.system,
    (roster?.systems ?? []).map((row) => row.name),
  );
  const selected = page.selected.map((item) => localSubject(item.id)).join(",");
  const doc = target.kind === "document" ? target.ref : null;
  const networkRead = ctx.readings.ducts;
  // Domain readonly sweep reached 28 files; snapshot consumers still require mutable arrays.
  const snapshot = (networkRead.value ?? null) as import("../../neutral").SnapshotReading | null;
  const pricing = ctx.readings.pricing;
  // Domain readonly owner: PricingResult/ducts-domain still exposes mutable arrays.
  // Counsel permits this one cast rather than widening beyond the bounded U4 input scope.
  const priced =
    pricing.status !== "failed" ? (pricing.value as PricingResult | undefined) : undefined;
  const edit = useMemo(() => stagedDucts(workDoc ?? null, workDoc ?? neutralFansWork), [workDoc]);
  const seen = useMemo(
    () => withStoredRulings(workDoc ?? null, snapshot?.store),
    [workDoc, snapshot],
  );
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "ducts:unbound";
  const selection = useMemo(
    () => Atom.make(attentionSubjects(page.selected.map(({ id }) => localSubject(id)))),
    [page.selected],
  );
  const select = (selected: string) =>
    ctx.page.select(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
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
          const value = cell.edit?.value;
          return value ? [[id, value]] : [];
        }),
      ),
    [workDoc],
  );
  const scope = useMemo(() => (snapshot ? scopeOf(snapshot, systems) : null), [snapshot, systems]);
  const claims = useMemo(
    () => claimsOf(scope ? claimsForGroup(claimCells, [...scope.members]) : claimCells),
    [scope, claimCells],
  );
  const subjectIds = scope?.groups
    .map((group) => edit.subject[group] ?? workDoc?.subject[group]?.edit?.value)
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
    switch (row.kind) {
      case "price": {
        const groups = active ? systemScope(snapshot, active).groups : [];
        if (groups.length) return ctx.verbs.scope({ groups: [...groups] }, ctx.workBasis);
        return;
      }
      case "heal": {
        const group = row.group ?? healTarget(snapshot, workDoc, active, selected, null);
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
                selected,
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
    const choice = scopeChoice.safeParse(row);
    return choice.success ? (
      <Button
        label="Choose write scope"
        onClick={() => {
          void stageScope(choice.data);
        }}
      >
        Choose write scope
      </Button>
    ) : null;
  };
  return {
    page,
    systems,
    active,
    selected,
    select,
    selectElement: (id: number | null) => select(id === null ? "" : String(id)),
    document: doc,
    attentionDoc,
    selection,
    snapshot: snapshot ?? EMPTY_SNAPSHOT,
    snapshotRead: networkRead,
    pricingRead: pricing,
    priced: priced?.priced ?? null,
    analysis: priced?.analysis ?? null,
    claims,
    onVerdict,
    subject: subjectIds ? { ids: subjectIds, claims, work: workDoc, onVerdict } : null,
    work: {
      doc: seen,
      revision: ctx.workBasis?.workRevision ?? null,
      write: (patches: RouteStatePatch[]) => write(patches),
    },
    captureSource: networkRead.current && doc && version ? { document: doc, version } : null,
    observation,
    scopeCommand,
    fanRoster: ctx.readings.fans.value?.rows ?? [],
    edit: pendingCount(workDoc ?? null, snapshot?.store),
    coverage: coverage
      ? { ...coverage, reading: networkRead.status === "pending" ? systems : [] }
      : null,
  };
}
const scopeChoice = z.object({
  kind: z.enum(["price", "heal", "assign-fan"]),
  group: z.string().optional(),
  unitId: z.number().optional(),
  systemId: z.number().optional(),
});
type NetworkData = ReturnType<typeof useNetworkData>;
type Coverage =
  | (Pick<NonNullable<NetworkData["coverage"]>, "read" | "of"> & {
      reading: readonly string[];
      report?: string;
    })
  | null
  | undefined;
type OwnContext<P extends keyof typeof ductsData.panes> = PaneContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  P
>;
function NetworkFrame({
  ctx,
  data,
  children,
  jump,
}: {
  ctx: NetworkContext;
  data: NetworkData;
  children: ReactNode;
  jump?: import("react").RefObject<((key: SubjectKey) => void) | null>;
}) {
  const subjectProps = useRevitSubjectProps();
  const nameOf = useMemo(() => subjectNamer(data.snapshot), [data.snapshot]);
  return (
    <DuctsOwner
      value={{
        selected: data.selected,
        select: data.select,
        cells: ctx.cells,
        commands: data.scopeCommand,
        fanRoster: data.fanRoster,
      }}
    >
      <NativeObservationScope value={data.observation}>
        <AttentionRoot doc={data.attentionDoc}>
          <PointerCite
            route="ducts"
            refs={(place) => pointerRefs(place, data.snapshot, data.attentionDoc, (id) => nameOf(id))}
          />
          <SubjectTextContext.Provider
            value={{
              doc: data.attentionDoc,
              nameOf,
              go: (id: number) =>
                jump?.current ? jump.current(elementKey(id)) : data.selectElement(id),
              refProps: subjectProps,
            }}
          >
            {!data.snapshotRead.value && (
              <LoadingContext
                name="Ducts"
                says={data.document ? "Reading ducts..." : "No document bound"}
                error={data.snapshotRead.status === "failed" ? data.snapshotRead.reason : null}
                busy={data.snapshotRead.status === "pending"}
              >
                {null}
              </LoadingContext>
            )}
            {children}
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
/** "n of m systems read", or null when the snapshot holds every system. */
const partialWord = (coverage: Coverage) =>
  coverage && coverage.read < coverage.of
    ? `${coverage.read} of ${coverage.of} systems read`
    : null;
/**
 * The systems list's empty state from the same coverage the read line counts: systems the
 * document holds but this read has not reached are "not read", never "none in scope".
 */
export const systemsEmpty = (coverage: Coverage) =>
  coverage && coverage.of > 0 && coverage.read === 0
    ? { message: `None of ${coverage.of} systems read yet`, exit: "Choose systems in Open systems" }
    : { message: "No duct systems in this scope", exit: "Read a model containing duct systems" };
/** The scoped read's extent. */
function ReadCoverage({ coverage }: { coverage: Coverage }) {
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
export function SystemsPane({ ctx }: { ctx: OwnContext<"e-systems"> }) {
  const search = useRouteSearchSlice((search) => search);
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, active, work, analysis, captureSource, coverage } = data;
  const { drawn, nameOf } = useTreeProjection(snapshot, priced, work.doc, systems);
  const systemRows = analysis?.systems ?? NO_SYSTEMS;
  const notes = analysis?.notes ?? NO_NOTES;
  const { systemSearch, systemSort } = page;
  const system = systems;
  const version = captureSource?.version ?? "";
  const systemKeys = { version, system, active, systemSearch, systemSort };
  const fansOf = useCallback(
    (system: ReturnType<typeof systemList>[number]) =>
      fanFacts(
        priced,
        system.groups,
        nameOf,
        drawn ? systemScope(drawn, system.name).terminals : undefined,
      ),
    [priced, nameOf, drawn],
  );
  const systemsPane = (
    <>
      <ReadCoverage coverage={coverage} />
      <a href={fansLink([], search)}>Fan inputs</a>
      <SystemColours work={work} />
      {(ctx.readings.roster.status === "failed" ? ctx.readings.roster.reason : null) ? (
        <p role="alert" data-tone="alarm">
          {ctx.readings.roster.status === "failed" ? ctx.readings.roster.reason : null}
        </p>
      ) : null}
      <Scroll className="min-h-0 flex-1">
        <SystemsList
          systems={systemRows}
          fansOf={fansOf}
          nameOf={nameOf}
          notes={notes}
          drawn={drawn}
          page={systemKeys}
          onQuery={(systemSearch, systemSort) => ctx.verbs.browse({ systemSearch, systemSort })}
          coverage={coverage}
        />
      </Scroll>
    </>
  );
  return (
    <NetworkFrame ctx={ctx} data={data}>
      <BarRules snapshot={drawn} work={work} priced={priced}>
        {systemsPane}
      </BarRules>
    </NetworkFrame>
  );
}
export function TreePane({ ctx }: { ctx: OwnContext<"e-sidebar"> }) {
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, work, captureSource, selectElement, select } = data;
  const selectedElement = focusedElement(data.selected);
  const ruleOf = ruleOfIds(priced);
  const { scope, trees, labels, nameOf } = useTreeProjection(snapshot, priced, work.doc, systems);
  const { neighbours } = useNeighbours(snapshot, scope, systems);
  const drawGroups = drawGroupsOf(snapshot, scope, systems);
  const connected = (() => {
    const shown = new Set(systems);
    const via = new Map<string, number[]>();
    for (const n of neighbours)
      for (const system of n.systems)
        if (!shown.has(system) && !via.get(system)?.includes(n.unit))
          via.set(system, [...(via.get(system) ?? []), n.unit]);
    return [...via].map(([system, units]) => ({ system, units }));
  })();
  const encoded = useGroupEncoding(snapshot, priced, drawGroups, page.encoding);
  const reading = encoded.encoding.quantity ? encoded.encoding : null;
  const grilleName = useCallback(
    (n: TreeNode) => {
      const id = n.kind === "run" ? n.terminal : n.id;
      return (id != null ? labels.get(id) : undefined) ?? n.name;
    },
    [labels],
  );
  const jumpToRule = (key: string) => select(`rule:${key}`);
  const tree = trees.length ? trees : null;
  const critical =
    tree
      ?.flatMap((t) => t.children)
      .filter((r) => r.terminal == null || !scope || scope.terminals.has(r.terminal))
      .reduce<TreeNode | null>(
        (best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best),
        null,
      ) ?? null;
  const scale = critical?.total ?? null;
  const designRate = priced?.edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  const treePane = tree ? (
    <>
      <Scroll className="min-h-0 flex-1">
        <div className="min-w-0 shrink-0">
          <SystemTree
            key={scope?.name}
            address={{
              scope: `${openKey(systems)}:${captureSource?.version ?? ""}`,
              search: page.treeSearch,
              sort: page.treeSort,
              onChange: (treeSearch, treeSort) => ctx.verbs.browse({ treeSearch, treeSort }),
            }}
            ctx={{
              trees: tree,
              scale,
              criticalKey: critical?.key ?? null,
              grilleName,
              selected: selectedElement,
              ruleOf,
              select: selectElement,
              jumpToRule,
              reading,
              designRate,
            }}
          />
          {connected.length ? (
            <div data-e-connected="" className="flex flex-col items-start py-1">
              <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">Connected</p>
              {connected.map(({ system, units }) => (
                <span key={system} data-e-connected-system={system}>
                  {`${system} · via ${units.map(nameOf).join(", ")}`}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Scroll>
    </>
  ) : null;
  return (
    <NetworkFrame ctx={ctx} data={data}>
      {treePane}
    </NetworkFrame>
  );
}
export function InboxBody({ ctx }: { ctx: OwnContext<"e-inbox"> }) {
  const data = useNetworkData(ctx);
  const {
    snapshot,
    priced,
    page,
    systems,
    work,
    captureSource,
    claims,
    edit,
    onVerdict,
    selected,
    select,
    selectElement,
  } = data;
  const projection = useTreeProjection(snapshot, priced, work.doc, systems);
  const { inbox } = useInboxProjection(snapshot, priced, work.doc, projection, claims, edit);
  const inboxWork = useMemo(
    () => ({ ...work, store: snapshot.store ?? null }),
    [work.doc, work.revision, work.write, snapshot],
  );
  const focused = inbox
    ? focusRow(
        selected,
        new Set(
          [...inbox.fix, ...inbox.set, ...inbox.check, ...inbox.diagnostics].map((row) => row.key),
        ),
      )
    : null;
  const handles: FanVerbs = { render: commands };
  return (
    <NetworkFrame ctx={ctx} data={data}>
      {inbox && (
        <ReachInbox
          groups={inbox}
          work={inboxWork}
          nameOf={projection.nameOf}
          onVerdict={onVerdict}
          onSelect={selectElement}
          onFocusCell={(cell) => select(cellFocusSubject(snapshot, systems, cell))}
          write={{ control: commands({ kind: "price" }), row: inbox.write }}
          heal={handles}
          fan={handles}
          cells={commands}
          selected={focusedElement(selected)}
          focused={focused}
          onPick={select}
          address={{
            scope: `${openKey(systems)}:${captureSource?.version ?? ""}`,
            search: page.rulingSearch,
            sort: page.rulingSort,
            onChange: (rulingSearch, rulingSort) => ctx.verbs.browse({ rulingSearch, rulingSort }),
          }}
        />
      )}
    </NetworkFrame>
  );
}
export function PictureBody({ ctx }: { ctx: OwnContext<"e-picture"> }) {
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, active, work, claims, edit, analysis, coverage } = data;
  const projection = useTreeProjection(snapshot, priced, work.doc, systems);
  const { drawn, scope, groups, trees, nameOf } = projection;
  const { heal, inbox } = useInboxProjection(snapshot, priced, work.doc, projection, claims, edit);
  const drawGroups = drawGroupsOf(snapshot, scope, systems);
  const { displayMembers, neighbours } = useNeighbours(snapshot, scope, systems);
  const activeScope = active ? systemScope(drawn, active) : null;
  const issues = useMemo(() => (inbox ? stageIssues(inbox) : []), [inbox]);
  const membership = useMemo(() => {
    const members = new Map<SubjectKey, readonly SubjectKey[]>();
    for (const issue of issues) members.set(`issue:${issue.key}`, issue.ids.map(elementKey));
    const walk = (node: TreeNode): number[] => {
      const ids = [
        ...new Set([...(node.id == null ? [] : [node.id]), ...node.children.flatMap(walk)]),
      ];
      if (node.kind !== "element") members.set(`${node.kind}:${node.key}`, ids.map(elementKey));
      return ids;
    };
    trees.forEach(walk);
    return members;
  }, [issues, trees]);
  const issueScope = useMemo(
    () =>
      scope
        ? new Set(
            drawn.groups
              .filter((group) => groups.includes(group.id))
              .flatMap((group) => group.issueIds),
          )
        : null,
    [scope, drawn, groups],
  );
  const diagnostic =
    page.rulingSearch.pills.find((pill) => pill.field === "kind" && pill.op === "=")?.value ?? "";
  const annotated = useMemo(
    () => (inbox ? annotatedFindings(inbox, heal, diagnostic) : new Set<string>()),
    [inbox, heal, diagnostic],
  );
  const encoded = useGroupEncoding(snapshot, priced, drawGroups, page.encoding);
  const activeCritical = trees
    .flatMap((tree) => tree.children)
    .filter((run) => run.terminal != null && activeScope?.terminals.has(run.terminal))
    .reduce<TreeNode | null>(
      (best, run) =>
        run.total != null && (best?.total == null || run.total > best.total) ? run : best,
      null,
    );
  const lead =
    activeScope?.groups.reduce<string | null>(
      (best, group) =>
        best == null ||
        (priced?.next.byGroup[group]?.fan ?? -Infinity) >
          (priced?.next.byGroup[best]?.fan ?? -Infinity)
          ? group
          : best,
      null,
    ) ?? "";
  const systemRows = analysis?.systems ?? NO_SYSTEMS;
  const notes = analysis?.notes ?? NO_NOTES;
  const chosen = systemRows.find((row) => row.key === active);
  const census = {
    systems: systemRows.length,
    priced: systemRows.filter((row) => row.total != null).length,
    fix: systemRows.filter((row) =>
      systemNoteCount(row, notes.get(row.key)).issues.some((issue) => issue.tone === "alarm"),
    ).length,
    partial: partialWord(coverage),
  };
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  return (
    <NetworkFrame ctx={ctx} data={data} jump={jump}>
      <div className="relative flex size-full min-w-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <DuctsPicture
            ctx={ctx}
            snapshot={data.snapshotRead.value ? snapshot : null}
            priced={priced}
            captureSource={data.captureSource}
            doc={data.document}
            subject={data.subject}
            claims={claims}
            onVerdict={data.onVerdict}
            work={work}
            selection={data.selection}
            renderPane={(body, furniture) => (
              <>
                {body}
                <PaneActions pane="e-picture">{furniture?.actions}</PaneActions>
              </>
            )}
            membership={membership}
            issueScope={issueScope}
            annotated={annotated}
            issues={issues}
            scale={encoded}
            nameOf={nameOf}
            jump={jump}
            groups={drawGroups}
            members={displayMembers}
            neighbours={neighbours}
            lead={lead}
            identity={{
              system: chosen ? { ...chosen, note: notes.get(chosen.key) } : null,
              census,
              refreshing: !data.snapshotRead.current,
              open: () => {},
              breakdown:
                activeCritical?.split && activeCritical.total
                  ? {
                      split: activeCritical.split,
                      scale: activeCritical.total,
                      fans: () => (
                        <FanFacts
                          facts={fanFacts(
                            priced,
                            activeScope?.groups ?? [],
                            nameOf,
                            activeScope?.terminals,
                          )}
                          nameOf={nameOf}
                        />
                      ),
                    }
                  : null,
            }}
          />
        </div>
      </div>
    </NetworkFrame>
  );
}
function useInboxProjection(
  snapshot: DuctSnapshot,
  priced: NetworkData["priced"],
  doc: NetworkData["work"]["doc"],
  projection: ReturnType<typeof useTreeProjection>,
  claims: NetworkData["claims"],
  edit: number,
) {
  return useMemo(() => {
    const { scope, nameOf, groupLabel } = projection;
    const surveyed = priced ?? survey(snapshot, doc);
    const heal = healPlan(snapshot, doc);
    const noRuns: InboxItem[] =
      priced && scope
        ? [
            ...new Set(noRunBranches(priced.snapshot, priced.next, scope, priced.flows).values()),
          ].map((branch) => ({
            key: `no-run:${branch.elements[0]}`,
            group: "diagnostics",
            kind: "no-run",
            title: "Branch with no run",
            status: "outside priced paths",
            ids: branch.elements,
            note: branch.reasons.map((reason) => reason.text).join("; "),
            parts: [
              "Branch ",
              { id: branch.elements[0]! },
              " has no run. ",
              ...noRunParts(branch, priced.snapshot),
              ...priced.findings
                .filter(
                  (finding) =>
                    finding.kind === "missed-join" &&
                    finding.elementIds.some((id) =>
                      branch.reasons.some((reason) => reason.at === id),
                    ),
                )
                .flatMap((finding) => [". ", finding.note]),
            ],
            verbs: [{ kind: "select", ids: branch.elements }],
          }))
        : [];
    const base = inboxRows({
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
      claims,
      write: { edit, esp: stagedEsp(doc) },
    });
    return { heal, inbox: { ...base, diagnostics: [...base.diagnostics, ...noRuns] } };
  }, [snapshot, priced, doc, projection, claims, edit]);
}
export function RulesBody({ ctx, wide = false }: { ctx: OwnContext<"e-rules">; wide?: boolean }) {
  const data = useNetworkData(ctx);
  const { snapshot, priced, systems, selected, work, select } = data;
  const { drawn, groups, nameOf } = useTreeProjection(snapshot, priced, work.doc, systems);
  const ruleFocus = selected.startsWith("rule:") ? selected.slice(5) : null;
  const requestedCell = cellFocusOf(selected);
  const landing = requestedCell?.pane === (wide ? "all" : "this") ? requestedCell : null;
  const setRuleFocus = (key: string | null) => select(key ? `rule:${key}` : "");
  const rulesPane = (
    <>
      {priced ? (
        <RulesTree
          snapshot={drawn ?? snapshot}
          priced={priced}
          groups={groups}
          wide={wide}
          work={work}
          focus={ruleFocus}
          onFocus={setRuleFocus}
          landing={landing}
          nameOf={nameOf}
        />
      ) : (
        <p className="text-ink-2 p-2">Loading rules</p>
      )}
    </>
  );
  return (
    <NetworkFrame ctx={ctx} data={data}>
      {rulesPane}
    </NetworkFrame>
  );
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
  onQuery,
  coverage,
}: {
  systems: ReturnType<typeof systemList>;
  /** The system's fans: its hover hint and the head of its breakdown popover. */
  fansOf: (system: ReturnType<typeof systemList>[number]) => FanFact[];
  nameOf: (id: number) => string;
  notes: ReadonlyMap<string, SystemNote>;
  drawn: DuctSnapshot | null;
  page: {
    system: readonly string[];
    active: string;
    systemSearch: NetworkData["page"]["systemSearch"];
    systemSort: NetworkData["page"]["systemSort"];
    version: string;
  };
  onQuery: (
    search: NetworkData["page"]["systemSearch"],
    sort: NetworkData["page"]["systemSort"],
  ) => void;
  coverage: Coverage;
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
        onQuery(next.search, next.sort);
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
export function AllRulesBody({ ctx }: { ctx: OwnContext<"e-rules-all"> }) {
  const { snapshot, work } = useNetworkData(ctx);
  const kinds = new Map(
    (snapshot?.nodes ?? [])
      .filter((node) => node.kind === "equipment")
      .map((node) => [catalogLinkKey(node.family, node.type), node]),
  );
  return (
    <>
      <RulesBody ctx={ctx} wide />
      <section aria-label="Unit kinds" className="flex flex-col gap-2 p-2">
        <h3 className="t-head">Unit kinds</h3>
        {[...kinds].map(([key, node]) => {
          const cell = ctx.work?.kinds[key] ?? {};
          const label = [node.family, node.type].filter(Boolean).join(" / ");
          return (
            <label key={key} className="flex flex-col gap-1">
              <span>{label}</span>
              <ChoiceCell
                label={`Unit kind ${label}`}
                cell={cell}
                path={["kinds", key]}
                current={cell.edit?.value.kind ?? suggestKind(node).kind}
                show={JSON.stringify}
                options={DUCT_UNIT_KINDS.map((kind) => ({
                  key: kind,
                  label: kind,
                  description: kindMeaning(node, kind),
                  disabled: kindDisabledReason(node, kind) ?? undefined,
                }))}
                refusal={ctx.workBasis ? null : "Read Work before editing"}
                pick={(kind) =>
                  void work.write(
                    cellPatches(["kinds"], key, cell, { kind: "set", rung: { value: { kind } } }),
                  )
                }
                act={async (path, cell, kind) =>
                  (await work.write(cellPatches(path.slice(0, -1), key, cell, { kind }))) ?? null
                }
              />
              {cell.edit && (
                <Button
                  label="Clear unit kind"
                  onClick={() =>
                    void work.write(cellPatches(["kinds"], key, cell, { kind: "clear" }))
                  }
                >
                  Clear unit kind
                </Button>
              )}
            </label>
          );
        })}
      </section>
    </>
  );
}
function useTreeProjection(
  snapshot: DuctSnapshot,
  priced: NetworkData["priced"],
  doc: NetworkData["work"]["doc"],
  systems: readonly string[],
) {
  return useMemo(() => {
    const drawn = priced?.snapshot ?? snapshot;
    const scope = scopeOf(drawn, systems);
    const groups = scope?.groups ?? NO_GROUPS;
    const sections = scope ? sectionsOf(drawn, systems) : new Map<string, string>();
    const sectionOf = (group: string) => {
      const others = scope?.shared.get(group);
      const name = sections.get(group) ?? scope?.name ?? "";
      return others?.length ? `${name} \u00b7 shared with ${others.join(", ")}` : name;
    };
    const trees = scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : [];
    const labels = grilleLabels(
      drawn,
      trees.flatMap((tree) => tree.children),
    );
    const subjectName = subjectNamer(snapshot);
    const nameOf = (id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot";
    const names = groupLabels(drawn);
    const groupLabel = (group: string) =>
      sections.has(group) ? sectionOf(group) : (names.get(group) ?? "a duct network");
    return { drawn, scope, groups, sections, sectionOf, trees, labels, nameOf, groupLabel };
  }, [snapshot, priced, doc, systems]);
}
function drawGroupsOf(
  snapshot: DuctSnapshot,
  scope: ReturnType<typeof scopeOf>,
  systems: readonly string[],
) {
  const groups = scope?.groups ?? NO_GROUPS;
  const raw = scopeOf(snapshot, systems)?.groups;
  if (!raw) return groups;
  const merged = [...snapshot.nodes, ...snapshot.segments].flatMap((element) =>
    element.groupId && scope?.members.has(element.id) ? [element.groupId] : [],
  );
  return [...new Set([...groups, ...raw, ...merged])];
}

function useNeighbours(
  snapshot: DuctSnapshot,
  scope: ReturnType<typeof scopeOf>,
  systems: readonly string[],
) {
  const displayMembers = useMemo(
    () =>
      scope
        ? new Set([...scope.members, ...(scopeOf(snapshot, systems)?.members ?? [])])
        : undefined,
    [scope, snapshot, systems],
  );
  const multi = useSyncExternalStore(knobsChanged, DUCTS_MULTI.read, DUCTS_MULTI.read).selection;
  const neighbours = useMemo(
    () => (displayMembers ? neighboursOf(snapshot, displayMembers, multi) : NO_NEIGHBOURS),
    [snapshot, displayMembers, multi],
  );
  return { displayMembers, neighbours };
}
