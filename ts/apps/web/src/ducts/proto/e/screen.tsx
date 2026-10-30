import { land } from "@pe/kit/lang/land";
/**
 * THROWAWAY (protoui round 3): E2 ("C simplicity, B layout"). LEFT a resizable double sidebar: a
 * top pane (all systems | the chosen system, tree over Inputs) over a bottom pane (all-systems
 * rules | this system's rules), one shared width handle; duct settings live in the chrome Settings; CENTRE C's full-bleed drawing with
 * numbered ruling pins and click popovers; RIGHT the inbox of rows a person has a verb on,
 * collapsed when it holds none. Hovering a row anywhere lights its element set on the drawing.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
} from "react";

import { survey, unitFlowsIn } from "@pe/ducts-domain/survey";
import { fansOwedBase, type OwedBase } from "@pe/ducts-domain/fan-assignment";
import { sectionsOf, systemOfGroup } from "@pe/ducts-domain/system-scope";
import { neighboursOf, type Neighbour } from "@pe/ducts-domain/neighbours";
import { Button } from "@pe/kit/lang/button";
import { systemSearch } from "@pe/ducts-domain/system-search";
import { useList, emptyListState, type ListOptions } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";

import { airflowOptions } from "../../airflow";
import { noRunParts, subjectNamer } from "../../subject-text";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { AttentionRoot, useIssueHover, useHoveredIssue } from "#/attention";
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
import type { ProtoProps } from "../props";
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
import { activeSystem, DUCTS_MULTI, toggleSystem, withSystem } from "../../selection";
import { subscribe as knobsChanged } from "#/knobs/knobs";
import { OpenSystems } from "./open-systems";

const NO_GROUPS: readonly string[] = [];
const NO_NEIGHBOURS: readonly Neighbour[] = [];
/** The open list as one string: what a hold, a side and a list scope key on. */
const openKey = (open: readonly string[]) => open.join(", ");
const NO_NOTES: ReadonlyMap<string, SystemNote> = new Map();
const NO_SYSTEMS: ReturnType<typeof systemList> = [];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const NetworkPanes = createContext<Readonly<Record<string, ReactNode>>>({});
export function NetworkPane({ id }: { id: string }) {
  return useContext(NetworkPanes)[id] ?? null;
}

export function NetworkProvider({ props, children }: { props: ProtoProps; children: ReactNode }) {
  return (
    <AttentionRoot doc={props.attentionDoc}>
      <LoadedScreenBody
        props={{ ...props, snapshot: props.snapshot ?? EMPTY_SNAPSHOT }}
        loading={!props.snapshot || props.pricing}
      >
        {children}
      </LoadedScreenBody>
    </AttentionRoot>
  );
}

/** "n of m systems read", or null when the snapshot holds every system. */
const partialWord = (coverage: ProtoProps["coverage"]) =>
  coverage && coverage.read < coverage.of
    ? `${coverage.read} of ${coverage.of} systems read`
    : null;

/** The scoped read's extent and its one verb: read every system, a few per read, into the panes. */
function ReadCoverage({ coverage }: { coverage: ProtoProps["coverage"] }) {
  const partial = partialWord(coverage);
  if (!coverage || !partial) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-2 t-small text-ink-2" data-e-coverage="">
      <span>
        {partial}
        {coverage.reading.length ? ` · reading ${coverage.reading.join(", ")}…` : ""}
      </span>
      {coverage.readAll ? (
        <Button
          label="Read every system, a few systems per read, so the totals cover the document"
          onClick={coverage.readAll}
        >
          Read every system
        </Button>
      ) : null}
    </p>
  );
}

/** Keep providers and graph demand mounted while the readings acquire or reprice. */
// TODO: N6: rebuild only changed pane projections on pricing delivery. The worker removes solve
// and triage CPU, but retained-display and result commits still exceed the interaction budget.
function LoadedScreenBody({
  props,
  children,
  loading,
}: {
  props: ProtoProps & { snapshot: NonNullable<ProtoProps["snapshot"]> };
  children: ReactNode;
  loading: boolean;
}) {
  const { snapshot, priced, page, setPage } = props;
  const doc = props.work.doc;
  const work = useMemo<LossesWork>(
    () => ({
      doc,
      revision: props.work.revision,
      write: props.work.write as unknown as LossesWork["write"],
    }),
    [doc, props.work.revision, props.work.write],
  );
  const inboxWork = useMemo(
    () => ({
      doc,
      revision: props.work.revision,
      write: work.write,
      store: snapshot?.store ?? null,
    }),
    [doc, props.work.revision, work.write, snapshot],
  );
  const ruleOf = useMemo(() => ruleOfIds(priced), [priced]);
  // The tree draws the topology that was priced (bridged joins, phase filter); the raw one left the
  // fan-setting run out (g8745870: header 0.186, tree critical 0.109). Healing still plans on raw.
  const drawn = priced?.snapshot ?? snapshot;
  // The subject is a Revit system: every group it is in, over the snapshot that was priced.
  // Several open systems are one scope: their groups in open order, a shared one once.
  const scope = useMemo(() => (drawn ? scopeOf(drawn, page.system) : null), [drawn, page.system]);
  const active = activeSystem(page);
  const activeScope = useMemo(
    () => (drawn && active ? systemScope(drawn, active) : null),
    [drawn, active],
  );
  const groups = scope?.groups ?? NO_GROUPS;
  const displayMembers = useMemo(
    () =>
      scope && snapshot
        ? new Set([...scope.members, ...scopeOf(snapshot, page.system)!.members])
        : undefined,
    [scope, snapshot, page.system],
  );
  // The drawing indexes the raw snapshot: a group the survey merged away is drawn by its raw id too.
  const drawGroups = useMemo(() => {
    const raw = snapshot ? scopeOf(snapshot, page.system)?.groups : undefined;
    if (!raw) return groups;
    const merged = [...snapshot.nodes, ...snapshot.segments].flatMap((e) =>
      e.groupId && scope?.members.has(e.id) ? [e.groupId] : [],
    );
    return [...new Set([...groups, ...raw, ...merged])];
  }, [snapshot, page.system, groups, scope]);
  // One hop: the networks a unit of a drawn group also roots, drawn as stubs near that unit.
  const multi = useSyncExternalStore(knobsChanged, DUCTS_MULTI.read, DUCTS_MULTI.read).selection;
  const neighbours = useMemo(
    () => (snapshot && scope ? neighboursOf(snapshot, displayMembers!, multi) : NO_NEIGHBOURS),
    [snapshot, scope, displayMembers, multi],
  );
  // A system a stub carries that no open network shows already, once, with the units joining it.
  const connected = useMemo(() => {
    const shown = new Set(page.system);
    const via = new Map<string, number[]>();
    for (const n of neighbours)
      for (const system of n.systems)
        if (!shown.has(system) && !via.get(system)?.includes(n.unit))
          via.set(system, [...(via.get(system) ?? []), n.unit]);
    return [...via].map(([system, units]) => ({ system, units }));
  }, [neighbours, page.system]);
  const systems = props.analysis?.systems ?? NO_SYSTEMS;
  // Each group an open system is in is its own section, named by the system and its units; a group
  // that carries other systems says so; only the open systems' members draw.
  const sections = useMemo(
    () => (drawn && scope ? sectionsOf(drawn, page.system) : new Map<string, string>()),
    [drawn, scope, page.system],
  );
  const sectionOf = useCallback(
    (g: string) => {
      const others = scope?.shared.get(g);
      const name = sections.get(g) ?? scope?.name ?? "";
      return others?.length ? `${name} · shared with ${others.join(", ")}` : name;
    },
    [sections, scope],
  );
  const trees = useMemo(
    () => (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf, scope.members) : []),
    [drawn, priced, doc, scope, groups, sectionOf],
  );
  const issueScope = useMemo(
    () =>
      drawn && scope
        ? new Set(drawn.groups.filter((g) => groups.includes(g.id)).flatMap((g) => g.issueIds))
        : null,
    [drawn, scope, groups],
  );
  const labels = useMemo(
    () =>
      drawn && trees.length
        ? grilleLabels(
            drawn,
            trees.flatMap((t) => t.children),
          )
        : new Map<number, string>(),
    [drawn, trees],
  );
  const subjectName = useMemo(() => (snapshot ? subjectNamer(snapshot) : () => null), [snapshot]);
  // One namer: a grille by its disambiguated label (the tree has no footnotes to tell twins apart),
  // everything else as Subject text names it, so a title, a row and a sentence agree.
  const nameOf = useCallback(
    (id: number) => labels.get(id) ?? subjectName(id) ?? "element not in snapshot",
    [labels, subjectName],
  );
  // A row names a group the way the system reads it, else by its systems and units; never its id.
  const names = useMemo(() => (drawn ? groupLabels(drawn) : new Map<string, string>()), [drawn]);
  const groupLabel = useCallback(
    (g: string) => (sections.has(g) ? sectionOf(g) : (names.get(g) ?? "a duct network")),
    [sections, sectionOf, names],
  );
  // The survey is the priced result's, or the unpriced one while the tables are unread; the
  // manifest's apply gate reads the same rows (`triage`) over the same tolerated snapshot.
  const surveyed = useMemo(
    () => priced ?? (snapshot ? survey(snapshot, doc) : null),
    [priced, snapshot, doc],
  );

  // What heals in Revit is planned over the raw snapshot (the tolerated one has bridged it already).
  const heal = props.analysis?.heal ?? null;
  const notes = props.analysis?.notes ?? NO_NOTES;
  // The document at a glance: how many systems price clean, and how many a person must fix first;
  // read by system, over the systems read so far, and it says so.
  const partial = partialWord(props.coverage);
  const census = useMemo(() => {
    const issues = systems.map((s) => systemNoteCount(s, notes.get(s.key)).issues);
    return {
      systems: systems.length,
      priced: systems.filter((s) => s.total != null).length,
      fix: issues.filter((i) => i.some((x) => x.tone === "alarm")).length,
      partial,
    };
  }, [systems, notes, partial]);
  const chosenRow = useMemo(() => {
    const row = systems.find((s) => s.key === activeSystem(page));
    return row ? { ...row, note: notes.get(row.key) } : null;
  }, [systems, page.system, notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const noRunRows = useMemo<InboxItem[]>(() => {
    if (!priced || !scope) return [];
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
          .filter(
            (f) =>
              f.kind === "missed-join" &&
              f.elementIds.some((id) => branch.reasons.some((r) => r.at === id)),
          )
          .flatMap((f) => [". ", f.note]),
      ],
      verbs: [{ kind: "select", ids: branch.elements }],
    }));
  }, [priced, scope]);
  // The subject is a system name, so a heal that renumbers its groups leaves the page where it was.
  const baseInbox = useMemo(
    () =>
      surveyed
        ? inboxRows({
            snapshot: surveyed.snapshot,
            scope,
            findings: surveyed.findings,
            flows: surveyed.flows,
            // A unit's flow as this system's groups price it, the flow its Inputs row and fan row show.
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
        : null,
    [
      surveyed,
      scope,
      props.captureSource?.version ?? "",
      doc,
      nameOf,
      groupLabel,
      heal,
      props.claims,
      props.edit,
      props.work.revision,
    ],
  );
  const inbox = useMemo(
    () => baseInbox && { ...baseInbox, diagnostics: [...baseInbox.diagnostics, ...noRunRows] },
    [baseInbox, noRunRows],
  );
  // A unit whose role is fan while no Revit system names it base equipment offers to make it one.
  const fanHandles: FanVerbs = { render: props.commands };
  const owedBase = useMemo(
    () =>
      snapshot && surveyed
        ? fansOwedBase(
            snapshot,
            surveyed.roles,
            (g) => priced?.next.byGroup[g]?.fans[0]?.unit ?? null,
          )
        : (new Map() as OwedBase),
    [snapshot, surveyed, priced],
  );
  const fanVerbsOf = useCallback(
    (id: number) => {
      // Only the open system is offered: the system comes from the page, the unit from the row.
      const verbs = (owedBase.get(id) ?? [])
        .filter((a) => a.system === active)
        .flatMap((a) => fanVerbs(a, nameOf));
      const split = [...(owedBase.split ?? [])].find(
        ([system, units]) => system === active && units.includes(id),
      );
      if (!verbs.length && split)
        return (
          <span className="t-small text-ink-2" data-e-fan-split={split[0]}>
            {`${split[0]} spans separate networks with their own fans (${split[1].map((u) => nameOf(u)).join(", ")}); Revit gives a system one fan, so split ${split[0]} in Revit first`}
          </span>
        );
      if (!verbs.length) return null;

      return (
        <span
          className="flex flex-wrap items-baseline gap-1"
          data-e-fan-verbs={id}
          onClick={(event) => event.stopPropagation()}
        >
          {verbs.map((v) => (
            <FanButton
              key={v.on.verb === "fan" ? v.on.systemId : v.label}
              verb={v}
              fan={fanHandles}
            />
          ))}
        </span>
      );
    },
    [owedBase, active, nameOf, fanHandles],
  );
  // A Set row's verb selects the element and focuses its cell once the tree has drawn it.
  // `system` is the open list's `openKey`.
  // A fitting's drop cell the inbox asked for, in the rules half that holds it.
  const [landing, setLanding] = useState<{ id: number; half: "all" | "this" } | null>(null);
  const [cellFocus, setCellFocus] = useState<CellRef | null>(null);
  // The rules pane lands on the cell: scroll it in, focus its control, mark it once (`--motion-land`).
  useEffect(() => {
    if (!landing) return;
    const half = document.querySelector(`[data-e-rules="${landing.half}"]`);
    const row =
      half?.querySelector<HTMLElement>(`[data-e-unruled-ids~="${landing.id}"]`) ??
      half?.querySelector<HTMLElement>(`[data-e-cell="componentDrops:${landing.id}"]`);
    if (!row) return;
    land(row, { focus: true });
    setLanding(null);
  }, [landing, priced]);
  useEffect(() => {
    if (!cellFocus) return;
    const input = document.querySelector<HTMLElement>(
      `[data-e-cell="${cellFocus.segment}:${cellFocus.id}"] input`,
    );
    if (!input) return;
    input.scrollIntoView?.({ block: "nearest" });
    input.focus();
    setCellFocus(null);
  }, [cellFocus, trees, priced]);
  const encoded = useGroupEncoding(snapshot, priced, drawGroups, page.encoding);
  // The tree reads the drawing's quantity; a categorical reading (or none) keeps Pe's fan-to-here loss.
  const reading = encoded.encoding.quantity ? encoded.encoding : null;
  const subjectProps = useRevitSubjectProps();
  const issues = useMemo(() => (inbox ? stageIssues(inbox) : []), [inbox]);
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  const setHoveredIssue = useIssueHover();
  const { system, systemSearch, systemSort } = page;
  const version = props.captureSource?.version ?? "";
  const systemKeys = useMemo(
    () => ({ version, system, systemSearch, systemSort }),
    [version, system, systemSearch, systemSort],
  );
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  const membership = useMemo(() => {
    const map = new Map<SubjectKey, readonly SubjectKey[]>();
    for (const issue of issues) map.set(`issue:${issue.key}`, issue.ids.map(elementKey));
    const walk = (node: TreeNode): number[] => {
      const ids = [
        ...new Set([...(node.id == null ? [] : [node.id]), ...node.children.flatMap(walk)]),
      ];
      if (node.kind !== "element")
        map.set(`${node.kind}:${node.key}` as SubjectKey, ids.map(elementKey));
      return ids;
    };
    trees.forEach(walk);
    return map;
  }, [issues, trees]);
  // The picture annotates the Fix rows' findings, or the Diagnostics kind picked in its key.
  const kindClause = page.rulingSearch.pills.find(
    (pill) => pill.field === "kind" && pill.op === "=",
  );
  const diagnosticKind = kindClause?.value ?? "";
  const annotated = useMemo(
    () => (inbox ? annotatedFindings(inbox, heal, diagnosticKind) : new Set<string>()),
    [inbox, heal, diagnosticKind],
  );

  // Stable, so the tree's memoized rows redraw only where a selection or cursor moved.
  const grilleName = useCallback(
    (n: TreeNode) => {
      const id = n.kind === "run" ? n.terminal : n.id;
      return (id != null ? labels.get(id) : undefined) ?? n.name;
    },
    [labels],
  );
  const jumpToRuleNow = useRef<(key: string) => void>(() => {});
  const jumpToRule = useCallback((key: string) => jumpToRuleNow.current(key), []);

  const tree = trees.length ? trees : null;
  const chosen = tree != null && scope != null;
  const select = props.onSelect;
  // The critical run is the largest priced total over every section: the worst fan's run (B's
  // model marks Pe's only when the group solve names one; a provisional solve can leave it
  // unnamed, so the largest total stands in). Only the runs that price the system count: a shared
  // group's other runs never lead. Header, tree and fan rows read one solve, `next`: the model
  // plus the edit cells, what the person is looking at while staging.
  const critical =
    tree
      ?.flatMap((t) => t.children)
      .filter((r) => r.terminal == null || !scope || scope.terminals.has(r.terminal))
      .reduce<TreeNode | null>(
        (best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best),
        null,
      ) ?? null;
  const scale = critical?.total ?? null;
  const selected = page.selected && /^\d+$/.test(page.selected) ? Number(page.selected) : null;
  const focusKey = inbox
    ? focusRow(
        page.issue,
        new Set(
          [...inbox.fix, ...inbox.set, ...inbox.check, ...inbox.diagnostics].map((i) => i.key),
        ),
      )
    : null;
  // A cell outside the system (a Set row on the whole document) moves the page to its system.
  const focusCell = useCallback(
    (cell: CellRef) => {
      if (cell.segment === "componentDrops") {
        // A fitting's drop lives in the bottom pane, in the half whose scope holds it. Nothing is
        // selected and the page does not move: the picture and its orbit stay as they were.
        const group = (drawn ?? snapshot).nodes.find((n) => n.id === cell.id)?.groupId;
        const mine = chosen && group != null && groups.includes(group);
        setLanding({ id: cell.id, half: mine ? "this" : "all" });
        return;
      }
      const into =
        scope && (scope.members.has(cell.id) || scope.units.has(cell.id))
          ? page.system
          : (() => {
              const node = snapshot.nodes.find((n) => n.id === cell.id);
              const g =
                node?.groupId ?? snapshot.groups.find((x) => x.rootIds.includes(cell.id))?.id;
              return g ? withSystem(page.system, systemOfGroup(drawn ?? snapshot, g)) : page.system;
            })();
      setPage({ system: into, selected: String(cell.id), issue: "" });
      setCellFocus(cell);
    },
    [drawn, snapshot, chosen, groups, scope, page.system, setPage],
  );
  // The section whose run leads the system: its fan and TEL head the pane.
  const activeCritical =
    tree
      ?.flatMap((t) => t.children)
      .filter((r) => r.terminal != null && activeScope?.terminals.has(r.terminal))
      .reduce<TreeNode | null>(
        (best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best),
        null,
      ) ?? null;
  const leadGroup =
    activeScope?.groups.reduce<string | null>(
      (best, g) =>
        best == null ||
        (priced?.next.byGroup[g]?.fan ?? -Infinity) > (priced?.next.byGroup[best]?.fan ?? -Infinity)
          ? g
          : best,
      null,
    ) ?? "";
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
  jumpToRuleNow.current = (key) => {
    setRuleFocus(key);
  };
  const designRate = priced?.edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  // The 2026-10-24 open-system chips supersede the 2026-10-23 no-header ruling. The header
  // carries scope and exits only; selected element facts remain in the picture.
  const treePane = useMemo(
    () =>
      tree ? (
        <>
          <OpenSystems
            system={page.system}
            onChange={(system) => setPage({ system })}
            whole={!partialWord(props.coverage)}
          />
          <Scroll className="min-h-0 flex-1">
            <div className="min-w-0 shrink-0">
              <SystemTree
                key={scope?.name}
                address={{
                  scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
                  search: page.treeSearch,
                  sort: page.treeSort,
                  onChange: (treeSearch, treeSort) =>
                    setPage({ treeSearch, treeSort }, { history: "replace" }),
                }}
                ctx={{
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
                }}
              />
              {connected.length ? (
                <div data-e-connected="" className="flex flex-col items-start py-1">
                  <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">Connected</p>
                  {connected.map(({ system, units }) => (
                    <Button
                      key={system}
                      label={`open ${system}`}
                      data-e-connected-system={system}
                      onClick={() => setPage({ system: withSystem(page.system, system) })}
                    >
                      {`${system} · via ${units.map(nameOf).join(", ")}`}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </Scroll>
        </>
      ) : null,
    [
      tree,
      scope?.name,
      page.system,
      props.captureSource?.version ?? "",
      page.treeSearch,
      page.treeSort,
      connected,
      nameOf,
      setPage,
      scale,
      critical?.key,
      grilleName,
      selected,
      ruleOf,
      select,
      jumpToRule,
      reading,
      designRate,
    ],
  );
  const systemsPane = useMemo(
    () => (
      <>
        <OpenSystems system={page.system} onChange={(system) => setPage({ system })} />
        <ReadCoverage coverage={props.coverage} />
        <Scroll className="min-h-0 flex-1">
          <SystemsList
            systems={systems}
            fansOf={fansOf}
            nameOf={nameOf}
            notes={notes}
            drawn={drawn}
            page={systemKeys}
            setPage={setPage}
          />
        </Scroll>
      </>
    ),
    [
      census.systems,
      census.priced,
      census.fix,
      props.coverage,
      systems,
      fansOf,
      nameOf,
      notes,
      drawn,
      systemKeys,
      page.system,
      setPage,
    ],
  );
  const rulesPanes = useMemo(
    () =>
      [false, true].map((wide) => (
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
              nameOf={nameOf}
            />
          ) : (
            <p className="text-ink-2 p-2">Loading rules</p>
          )}
        </>
      )),
    [scope?.name, priced, drawn, snapshot, groups, work, ruleFocus, nameOf],
  );
  const inputsCount = scope
    ? `${plural(scope.units.size, "unit")} · ${plural(scope.terminals.size, "grille")}`
    : "";
  const inputsPane = useMemo(
    () =>
      tree && scope ? (
        <>
          <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">flow · ESP · role · drop</p>
          <InputsPane
            address={{
              scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
              search: page.inputSearch,
              sort: page.inputSort,
              onChange: (inputSearch, inputSort) =>
                setPage({ inputSearch, inputSort }, { history: "replace" }),
            }}
            fanVerbs={fanVerbsOf}
            snapshot={drawn ?? snapshot}
            priced={priced}
            work={work}
            scope={scope}
            nameOf={nameOf}
            selected={selected}
            select={select}
          />
        </>
      ) : null,
    [
      tree,
      scope,
      inputsCount,
      page.system,
      props.captureSource?.version ?? "",
      page.inputSearch,
      page.inputSort,
      setPage,
      fanVerbsOf,
      drawn,
      snapshot,
      priced,
      work,
      nameOf,
      selected,
      select,
    ],
  );
  const writeVerbs: WriteVerbs | null = inbox
    ? { control: props.commands({ kind: "price" }), row: inbox.write }
    : null;
  const healHandles: FanVerbs = { render: props.commands };
  const inboxPane = useMemo(
    () => (
      <>
        {inbox ? (
          <ReachInbox
            groups={inbox}
            work={inboxWork}
            nameOf={nameOf}
            onVerdict={props.onVerdict}
            onSelect={select}
            onFocusCell={focusCell}
            write={writeVerbs!}
            heal={healHandles}
            fan={fanHandles}
            cells={props.cells}
            selected={selected}
            focused={focusKey}
            onPick={(issue) => setPage({ selected: "", issue }, { history: "push" })}
            address={{
              scope: `${openKey(page.system)}:${props.captureSource?.version ?? ""}`,
              search: page.rulingSearch,
              sort: page.rulingSort,
              onChange: (rulingSearch, rulingSort) =>
                setPage({ rulingSearch, rulingSort }, { history: "replace" }),
            }}
          />
        ) : null}
      </>
    ),
    [
      inbox,
      inboxWork,
      nameOf,
      props.onVerdict,
      select,
      focusCell,
      writeVerbs,
      healHandles,
      fanHandles,
      selected,
      focusKey,
      setHoveredIssue,
      setPage,
      page.system,
      props.captureSource?.version ?? "",
      page.rulingSearch,
      page.rulingSort,
    ],
  );

  const subjectContext = useMemo(
    () => ({
      doc: props.attentionDoc,
      nameOf: subjectName,

      go: (id: number) => (jump.current ? jump.current(elementKey(id)) : select(id)),
      refProps: subjectProps,
    }),
    [props.attentionDoc, subjectName, select, subjectProps],
  );

  const picturePane = (
    <div className="relative size-full min-w-0">
      {" "}
      <DuctsPicture
        renderPane={(body) => body}
        {...props}
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
        lead={leadGroup}
        identity={{
          system: chosenRow,
          census,
          refreshing: props.reading.refreshing,
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
          allSystems: () => setPage({ system: [] }),
        }}
      />
    </div>
  );
  const loadingBody = (
    <LoadingContext
      name="Ducts"
      says={props.empty?.says ?? "Pricing ducts..."}
      error={props.reading.error}
      busy={props.reading.pending || props.pricing}
    >
      <ReadCoverage coverage={props.coverage} />
    </LoadingContext>
  );
  const panes = {
    "e-systems": (
      <BarRules snapshot={drawn} work={work} priced={priced}>
        {systemsPane}
      </BarRules>
    ),
    "e-sidebar": treePane,
    "e-inputs": (
      <>
        <DesignFriction work={work} rate={designRate} />
        <ParameterSlots work={work} snapshot={snapshot} scope={scope} />
        <SystemColours work={work} />
        {inputsPane}
      </>
    ),
    "e-rules-all": rulesPanes[1],
    "e-rules": rulesPanes[0],
    "e-picture": picturePane,
    "e-inbox": inboxPane,
  };
  return (
    <SubjectTextContext.Provider value={subjectContext}>
      <NetworkPanes value={loading ? { "e-picture": loadingBody } : panes}>{children}</NetworkPanes>
    </SubjectTextContext.Provider>
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
  setPage,
}: {
  systems: ReturnType<typeof systemList>;
  /** The system's fans: its hover hint and the head of its breakdown popover. */
  fansOf: (system: ReturnType<typeof systemList>[number]) => FanFact[];
  nameOf: (id: number) => string;
  notes: ReadonlyMap<string, SystemNote>;
  drawn: ProtoProps["snapshot"];
  page: Pick<ProtoProps["page"], "system" | "systemSearch" | "systemSort"> & { version: string };
  setPage: ProtoProps["setPage"];
}) {
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
    // A pick opens the system beside the others, or closes it when it is open.
    onPick: (system) => setPage({ system: toggleSystem(page.system, system.key) }),
  });
  const active = activeSystem(page);
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
          () => setPage({ system: withSystem(page.system, system.key) }),
          notes.get(system.key),
          fans.map((f) => `${nameOf(f.unit)} ${f.role}: ${f.says}`),
          () => <FanFacts facts={fans} nameOf={nameOf} />,
        );
      }}
      projection={(system) => ({ weight: systemNoteCount(system, notes.get(system.key)).total })}
      empty={{
        message: "No duct systems in this scope",
        exit: "Read a model containing duct systems",
      }}
    />
  );
});

/** The inbox redraws only when the hovered issue (its rail) changes. */
function ReachInbox(props: Omit<ComponentProps<typeof Inbox>, "hoveredIssue">) {
  const issue = useHoveredIssue();
  return <Inbox {...props} hoveredIssue={issue} />;
}
