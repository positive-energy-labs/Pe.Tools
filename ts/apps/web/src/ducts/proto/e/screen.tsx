import { Settings } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  SubjectPopoverContent as PopoverContent,
} from "@pe/kit/lang/popover";
import { useRouteSearchSlice } from "#/route/activity";
import { fansLink } from "../../../fans/route.ts";
import { useHoveredIssue } from "#/attention";
import { PointerCite } from "#/shell/pointer-list";
import { ductElements, pointerRefs } from "../../identity.ts";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { LoadingContext } from "#/route/loading-context";
import { PaneActions } from "#/shell/pane-actions";
import { useAdmittedSubject } from "#/shell/subject";
import {
  DUCT_UNIT_KINDS,
  neutralFansWork,
  stagedDucts,
  subjectCode,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { suggestKind } from "@pe/ducts-domain/roster";
import { StateCell } from "@pe/kit/lang/cell";
import { kindMeaning, kindDisabledReason } from "../../sheet/kind-meaning.ts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { neighboursOf, type Neighbour } from "@pe/ducts-domain/neighbours";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { pendingCount, stagedEsp } from "@pe/ducts-domain/staged";
import { unitFlowsView as unitFlowsIn } from "@pe/ducts-domain/pricing-view";
import { scopeOf, sectionsOf, systemScope } from "@pe/ducts-domain/system-scope";
import { systemSearch } from "@pe/ducts-domain/system-search";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { groupLabels } from "@pe/ducts-domain/words";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, useValue, type ValueHandle, type ListOptions } from "@pe/kit/lang/collection";
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
import type { DuctsDrawContext } from "../../route.ts";
import { roster as rosterRead, network as networkSource } from "../../route.ts";
import { airflowOptions } from "../../airflow";
import { cellFocusOf, cellFocusSubject, focusedElement, issueOf, issueSubject, selectedKeys } from "../../cell-focus";
import {
  annotatedFindings,
  focusRow,
  inboxRows,
  stageIssues,
  type InboxItem,
} from "../../inbox-rows";
import { activeName, namesOf, systemCode } from "../../identity.ts";
import { DuctsOwner, commands } from "../../pane-context";
import { DUCTS_MULTI } from "../../selection";
import type { EditMeta } from "../../sheet/input-history.neutral";
import { EMPTY_SNAPSHOT } from "../../sheet/scoped-snapshot";
import { noRunParts, subjectNamer } from "../../subject-text";
import type { systemList } from "../../system-list";
import type { SystemNote } from "../../system-list-search";
import { systemReadCoverage } from "@pe/ducts-domain/system-reads";
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
type NetworkContext = DuctsDrawContext;
function useNetworkData(ctx: NetworkContext) {
  const workDoc = ctx.value.value?.design ?? null;
  const target = ctx.target;
  const page = ctx.page.read();
  const roster = useValue(ctx.read(rosterRead));
  const system = namesOf(page.system);
  const systems = useMemo(
    () => (system === "all" ? (roster?.systems ?? []).map((row) => row.name) : system),
    [page.system, roster],
  );
  const active = activeName(
    page.system,
    (roster?.systems ?? []).map((row) => row.name),
  );
  const selected = page.selected.map((item) => item.id).join(",");
  const doc = target?.kind === "document" ? target.ref : null;
  const networkRead=ctx.read(networkSource);
  // The existing drawing views accept mutable arrays; decoded Values stay immutable.
  const snapshot = (networkRead.value ?? null) as
    | import("@pe/agent-contracts").DuctsNetworkData
    | null;
  const pricing = ctx.value;
  const pricingData = useValue(pricing);
  const priced = pricing.current ? pricingData : undefined;
  const edit = useMemo(() => stagedDucts(workDoc ?? null, workDoc ?? neutralFansWork), [workDoc]);
  const seen = ctx.value.value?.effectiveDesign ?? null;
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "ducts:unbound";
  const selection = useMemo(
    () => Atom.make<ReadonlySet<SubjectKey>>(new Set(selectedKeys(page.selected.map(({ id }) => id)))),
    [page.selected],
  );
  const select = (selected: string) =>
    ctx.page.select(selected ? [{ kind: "focus", id: selected }] : []);
  const write = useCallback(
    async (patches: RouteStatePatch[], history?: EditMeta) => {
      return ctx.cells.patch(patches, history);
    },
    [ctx],
  );
  const scope = useMemo(() => (snapshot ? scopeOf(snapshot, systems) : null), [snapshot, systems]);
  const subjectIds = scope?.groups
    .map((group) => edit.subject[group] ?? workDoc?.subject[group]?.edit?.value)
    .find((ids) => ids != null);
  const version = snapshot?.sourceVersion;
  // Domain readonly sweep reached 28 files; coverage still accepts the mutable snapshot alias.
  const coverage = roster
    ? systemReadCoverage(
        snapshot,
        roster as unknown as import("@pe/ducts-domain/types").DuctSnapshot,
      )
    : null;
  const stageScope = async (row: {
    kind?: string;
    group?: string;
    unitId?: number;
    systemId?: number;
  }) => {
    if (!snapshot) return;
    const group = (key: string) => subjectCode({ keyKind: "group", key });
    let intent: { groups: string[] } | { fan: { unitId: number; systemId: number } } | null = null;
    if (row.kind === "price") {
      const groups = active ? systemScope(snapshot, active).groups : [];
      if (groups.length) intent = { groups: groups.map(group) };
    } else if (
      row.kind === "heal" &&
      row.group &&
      active &&
      systemScope(snapshot, active).groups.includes(row.group)
    ) {
      intent = { groups: [group(row.group)] };
    } else if (
      row.kind === "assign-fan" &&
      row.unitId != null &&
      row.systemId != null &&
      snapshot.systems.find((system) => system.id === row.systemId)?.name === active
    ) {
      intent = { fan: { unitId: row.unitId, systemId: row.systemId } };
    }
    return intent
      ? ctx.cells.at(["writeIntent"]).stage(intent, { label: "Choose write scope" })
      : { code: "scope", message: "Choose a write target in the active system" };
  };
  const scopeCommand = (row?: unknown) => {
    const choice = scopeChoice.safeParse(row);
    return choice.success ? (
      <Button
        label="Choose write scope"
        refusal={ctx.cells.refusal}
        onPress={async () => (await stageScope(choice.data)) ?? null}
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
    selectElement: (id: number | null) => select(id === null ? "" : (ductElements(snapshot).keyOf(id) ?? "")),
    document: doc,
    attentionDoc,
    selection,
    snapshot: snapshot ?? EMPTY_SNAPSHOT,
    snapshotRead: networkRead,
    pricingRead: pricing,
    priced: priced?.priced ?? null,
    analysis: priced?.analysis ?? null,
    subject: subjectIds ? { ids: subjectIds, work: workDoc } : null,
    work: {
      doc: seen,
      revision: ctx.cells.basis?.workRevision ?? null,
      write: (patches: RouteStatePatch[]) => write(patches),
    },
    captureSource: networkRead.current && doc && version ? { document: doc, version } : null,
    scopeCommand,
    fanRoster: ctx.value.value?.fanRows ?? [],
    edit: pendingCount(workDoc ?? null, snapshot?.store, snapshot ?? { nodes: [], segments: [] }),
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
  const elements = useMemo(() => ductElements(data.snapshot), [data.snapshot]);
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


          <PointerCite
            route="ducts"
            refs={(place) =>
              pointerRefs(place, data.snapshot, data.attentionDoc, (id) => nameOf(id))
            }
          />
          <SubjectTextContext.Provider
            value={{
              doc: data.attentionDoc,
              nameOf,
              uniqueIdOf: elements.uniqueIdOf,
              go: (id: number) => {
                const key = elements.keyOf(id);
                return jump?.current && key ? jump.current(key) : data.selectElement(id);
              },
              refProps: subjectProps,
            }}
          >
            {children}
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
            {!ctx.value.current && "reason" in ctx.value && ctx.value.reason && (
              <p role="status" className="p-2 text-ink-2">
                {ctx.value.reason}
              </p>
            )}
          </SubjectTextContext.Provider>


    </DuctsOwner>
  );
}
const NO_GROUPS: readonly string[] = [];
const NO_NEIGHBOURS: readonly Neighbour[] = [];
/** The open list as one string: what a hold, a side and a list scope key on. */
const openKey = (open: readonly string[]) => open.join(", ");
const NO_NOTES: Readonly<Record<string,SystemNote>> = {};
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
export function SystemsPane({ ctx }: { ctx: DuctsDrawContext }) {
  const search = useRouteSearchSlice((search) => search);
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, active, work, analysis, captureSource, coverage } = data;
  const { drawn, nameOf } = useTreeProjection(snapshot, priced, work.doc, systems);
  const rosterState = ctx.read(rosterRead);
  const roster = useValue(rosterState);
  const systemRows = analysis?.systems ?? (roster?.rows ?? NO_SYSTEMS);
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
      <Scroll className="min-h-0 flex-1">
        <SystemsList
          header={
            <div className="flex flex-wrap items-center justify-between gap-2 p-1">
              <span className="t-small">
                {systemRows.length} systems / {systems.length} open
              </span>
              <Popover>
                <PopoverTrigger render={<Button icon={Settings} label="Duct settings" />} />
                <PopoverContent className="w-80 p-2">
                  <a href={fansLink([], search)}>Fan inputs</a>
                  <SystemColours work={work} />
                </PopoverContent>
              </Popover>
            </div>
          }
          systems={systemRows}
          value={ctx.value.current ? ctx.value : rosterState}
          fansOf={fansOf}
          nameOf={nameOf}
          notes={notes}
          drawn={drawn}
          page={systemKeys}
          onQuery={(systemSearch, systemSort) => ctx.page.query({ systemSearch, systemSort })}
          coverage={coverage}
        />
      </Scroll>
      <ReadCoverage coverage={coverage} />
      {(rosterState.status === "failed" ? rosterState.reason : null) ? (
        <p role="alert" data-tone="caution">
          {rosterState.status === "failed" ? rosterState.reason : null}
        </p>
      ) : null}
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
export function TreePane({ ctx }: { ctx: DuctsDrawContext }) {
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, work, captureSource, selectElement, select } = data;
  const selectedElement = focusedElement(data.selected, ductElements(snapshot));
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
              onChange: (treeSearch, treeSort) => ctx.page.query({ treeSearch, treeSort }),
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
export function InboxBody({ ctx }: { ctx: DuctsDrawContext }) {
  const data = useNetworkData(ctx);
  const {
    snapshot,
    priced,
    page,
    systems,
    work,
    captureSource,
    edit,
    selected,
    select,
    selectElement,
  } = data;
  const projection = useTreeProjection(snapshot, priced, work.doc, systems);
  const { inbox } = useInboxProjection(
    snapshot,
    priced,
    work.doc,
    projection,
    edit,
    data.analysis,
  );
  const inboxWork = useMemo(
    () => ({ ...work, store: snapshot.store ?? null }),
    [work.doc, work.revision, work.write, snapshot],
  );
  const focused = inbox
    ? focusRow(
        issueOf(selected) || selected,
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
          onSelect={selectElement}
          onFocusCell={(cell) => select(cellFocusSubject(snapshot, systems, cell))}
          write={{ control: commands({ kind: "price" }), row: inbox.write }}
          heal={handles}
          fan={handles}
          cells={commands}
          selected={focusedElement(selected, ductElements(snapshot))}
          focused={focused}
          onPick={(key) => select(issueSubject(key))}
          address={{
            scope: `${openKey(systems)}:${captureSource?.version ?? ""}`,
            search: page.rulingSearch,
            sort: page.rulingSort,
            onChange: (rulingSearch, rulingSort) => ctx.page.query({ rulingSearch, rulingSort }),
          }}
        />
      )}
    </NetworkFrame>
  );
}
export function PictureBody({ ctx }: { ctx: DuctsDrawContext }) {
  const data = useNetworkData(ctx);
  const { snapshot, priced, page, systems, active, work, edit, analysis, coverage } = data;
  const projection = useTreeProjection(snapshot, priced, work.doc, systems);
  const { drawn, scope, groups, trees, nameOf } = projection;
  const { heal, inbox } = useInboxProjection(
    snapshot,
    priced,
    work.doc,
    projection,
    edit,
    data.analysis,
  );
  const drawGroups = drawGroupsOf(snapshot, scope, systems);
  const { displayMembers, neighbours } = useNeighbours(snapshot, scope, systems);
  const activeScope = active ? systemScope(drawn, active) : null;
  const issues = useMemo(() => (inbox ? stageIssues(inbox) : []), [inbox]);
  const membership = useMemo(() => {
    const members = new Map<SubjectKey, readonly SubjectKey[]>();
    const elements = ductElements(snapshot);
    const keys = elements.keysOf;
    for (const issue of issues) members.set(`issue:${issue.key}`, keys(issue.ids));
    const walk = (node: TreeNode): number[] => {
      const ids = [
        ...new Set([...(node.id == null ? [] : [node.id]), ...node.children.flatMap(walk)]),
      ];
      if (node.kind !== "element") members.set(`${node.kind}:${node.key}`, keys(ids));
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
      systemNoteCount(row, notes[row.key]).issues.some((issue) => issue.tone === "alarm"),
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
            analysis={analysis}
            captureSource={data.captureSource}
            doc={data.document}
            subject={data.subject}
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
              system: chosen ? { ...chosen, note: notes[chosen.key] } : null,
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
  edit: number,
  analysis: NetworkData["analysis"],
) {
  return useMemo(() => {
    const { scope, nameOf, groupLabel } = projection;
    if (!priced || !analysis) return { heal: null, inbox: null };
    const surveyed = priced;
    const heal = analysis.heal;
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
      write: { edit, esp: stagedEsp(doc) },
    });
    return { heal, inbox: { ...base, diagnostics: [...base.diagnostics, ...noRuns] } };
  }, [snapshot, priced, doc, projection, edit, analysis]);
}
export function RulesBody({ ctx, wide = false }: { ctx: DuctsDrawContext; wide?: boolean }) {
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
      ) : ctx.value.status === "pending" ? (
        // Loading only while pending; a settled refusal (nothing to price) is the frame's reason line.
        <p className="text-ink-2 p-2">Loading rules</p>
      ) : null}
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
  header,
  systems,
  value,
  fansOf,
  nameOf,
  notes,
  drawn,
  page,
  onQuery,
  coverage,
}: {
  header: ReactNode;
  systems: ReturnType<typeof systemList>;
  value: ValueHandle<unknown>;
  /** The system's fans: its hover hint and the head of its breakdown popover. */
  fansOf: (system: ReturnType<typeof systemList>[number]) => FanFact[];
  nameOf: (id: number) => string;
  notes: Readonly<Record<string,SystemNote>>;
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
  const systemId = (name: string) => systemCode(name);
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
        read: (system) => ((notes[system.key]?.fix ?? 0) > 0 ? "yes" : "no"),
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
    value,
    rowsOf: () => systems,
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
  }, [active, systemListView.target]);
  return (
    <ListView
      aria-label="systems"
      search="always"
      header={
        <>
          {header}
          <div className="flex gap-1 px-1">
            <Button label="All systems" onPress={() => door?.all()}>
              All
            </Button>
            <Button label="Clear systems" onPress={() => door?.clear()}>
              Clear
            </Button>
          </div>
        </>
      }
      list={systemListView}
      row={(system) => {
        const fans = fansOf(system);
        return systemRowParts(
          system,
          () => door?.toggle(systemId(system.key)),
          notes[system.key],
          fans.map((f) => `${nameOf(f.unit)} ${f.role}: ${f.says}`),
          () => <FanFacts facts={fans} nameOf={nameOf} />,
        );
      }}
      projection={(system) => ({ weight: systemNoteCount(system, notes[system.key]).total })}
      empty={systemsEmpty(coverage)}
    />
  );
});
/** The inbox redraws only when the hovered issue (its rail) changes. */
function ReachInbox(props: Omit<ComponentProps<typeof Inbox>, "hoveredIssue">) {
  const issue = useHoveredIssue();
  return <Inbox {...props} hoveredIssue={issue} />;
}
export function AllRulesBody({ ctx }: { ctx: DuctsDrawContext }) {
  const { snapshot } = useNetworkData(ctx);
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
          const cell = ctx.cells.at(["kinds", key]);
          const label = [node.family, node.type].filter(Boolean).join(" / ");
          return (
            <label key={key} className="flex flex-col gap-1">
              <span>{label}</span>
              <StateCell
                label={`Unit kind ${label}`}
                cell={cell}
                value={ctx.value}
                model={suggestKind(node)}
                keyOf="kind"
                format={JSON.stringify}
                options={DUCT_UNIT_KINDS.map((kind) => ({
                  key: kind,
                  value: { kind },
                  label: kind,
                  description: kindMeaning(node, kind),
                  disabled: kindDisabledReason(node, kind) ?? undefined,
                }))}

              />
              {cell.value.edit && (
                <Button
                  label="Clear unit kind"
                  onClick={() =>
                    void cell.clear({ label: `Clear unit kind ${label}` })
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
