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
  type ComponentProps,
  type ReactNode,
} from "react";
import type { DuctsApply } from "@pe/host-contracts/generated";
import { flushSync } from "react-dom";
import { survey, unitFlowsIn } from "@pe/ducts-domain/survey";
import { fansOwedBase, type OwedBase } from "@pe/ducts-domain/fan-assignment";
import { healPlan } from "@pe/ducts-domain/heal";
import { sectionNames, systemOfGroup, systemScope } from "@pe/ducts-domain/system-scope";
import { Button } from "@pe/kit/lang/button";
import { systemSearch } from "@pe/ducts-domain/system-search";
import { useList, emptyListState } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";

import { airflowOptions } from "../../airflow";
import { systemsNeedingFix } from "../../system-list-search";
import { noRunParts, subjectNamer } from "../../subject-text";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import {
  NO_LIGHTING,
  reachStore,
  SubjectTextContext,
  useReach,
  type ReachStore,
  type SubjectReference,
} from "@pe/kit/lang/subject-text";
import {
  annotatedFindings,
  stageIssues,
  fanVerbs,
  healRunView,
  focusRow,
  inboxRows,
  holding,
  type CellRef,
  type InboxItem,
} from "../../inbox-rows";
import { groupLabels } from "@pe/ducts-domain/words";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { stagedEsp } from "@pe/ducts-domain/staged";
import { previewFresh } from "../../manifest";
import type { LossesWork } from "../../work";
import { reviewLines, writePreview } from "../../write-review";
import { buildTree, systemList, type TreeNode } from "../b/model";
import type { ProtoProps } from "../props";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { BarRules, systemIssues, systemRowParts } from "./bar";
import { DuctSettings } from "./settings";
import { FanFacts, fanFacts, type FanFact } from "./fan-sections";
import { ECanvas, OpeningContext } from "./canvas";
import { grilleLabels } from "./labels";
import { FanButton, Inbox, type FanVerbs } from "./inbox";
import { InputsPane } from "./inputs-pane";
import { RulesTree, ruleOfIds } from "./rules-pane";
import { SystemTree } from "./tree-sidebar";
import { useGroupEncoding } from "../encoding/use-encoding";

const NO_GROUPS: readonly string[] = [];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Side = "left" | "right";

/** Below this the screen is narrow: the inbox is a rail until asked for. Below TIGHT the sidebar is too. */
const NARROW_PX = 1100;
const TIGHT_PX = 700;

/** The element's width, measured; 0 until it is (jsdom never measures). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One pane of the sidebar, split into its all-systems half (left) and its this-system half
 * (right). One half is open; the other is the shared PaneSplit rail, so a half is never squeezed.
 * A half with a `refusal` stays a drawn, inert rail: nothing to open until a system is chosen.
 */
function Halves({
  side,
  onSide,
  left,
  right,
}: {
  side: Side;
  onSide: (side: Side) => void;
  left: { title: string; pane: ReactNode; refusal?: string };
  right: { title: string; pane: ReactNode; refusal?: string };
}) {
  const closed = side === "left" ? right : left;
  return (
    <PaneSplit
      axis="horizontal"
      start={left.pane}
      end={right.pane}
      resize={{
        target: side === "left" ? "end" : "start",
        defaultSize: 32,
        minSize: 32,
        collapse: {
          collapsed: true,
          collapsedSize: 32,
          title: closed.title,
          refusal: closed.refusal,
          onCollapsedChange: (collapsed) => {
            if (!collapsed && closed.refusal == null) onSide(side === "left" ? "right" : "left");
          },
        },
      }}
    />
  );
}

/** A two-line system row before it is measured, px (two item heights). */
const LIST_ROW_PX = 48;

/**
 * The read snapshot is priced once the tables are in (2-3 s on a large model): until then the
 * screen says so instead of holding the first paint.
 */
export function EScreen({ props }: { props: ProtoProps }) {
  // A system switch re-renders every pane for about a second. The body is held at its last props
  // until a frame has painted the picture plate's "opening …" line (`OpeningContext`), then renders
  // the new system. `useDeferredValue` was tried: React ran the deferred pass before the paint.
  const [system, setSystem] = useState(props.page.system);
  const [requested, setRequested] = useState<string | null>(null);
  const opening = requested ?? (system === props.page.system ? null : props.page.system);
  const latest = useRef(props);
  latest.current = props;
  const flight = useRef<{ frame?: number; timer?: number; pending?: boolean }>({});
  useEffect(
    () => () => {
      cancelAnimationFrame(flight.current.frame ?? 0);
      clearTimeout(flight.current.timer);
    },
    [],
  );
  const move = useCallback<ProtoProps["setPage"]>((next, how) => {
    if (next.system === undefined) return latest.current.setPage(next, how);
    if (flight.current.pending) return;
    if (next.system === latest.current.page.system) return latest.current.setPage(next, how);
    flight.current.pending = true;
    // Paint acknowledgement before the route/router compute the next system. Refuse repeat picks.
    flushSync(() => setRequested(next.system!));
    flight.current.frame = requestAnimationFrame(() => {
      flight.current.frame = undefined;
      flight.current.timer = window.setTimeout(() => {
        flight.current.timer = undefined;
        latest.current.setPage(next, how);
      }, 0);
    });
  }, []);
  useEffect(() => {
    if (opening == null || (requested != null && props.page.system !== requested)) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        setSystem(props.page.system);
        setRequested(null);
        flight.current.pending = false;
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [opening, props.page.system, requested]);
  const shown = useRef(props);
  if (opening == null) shown.current = { ...props, setPage: move };
  if (!props.snapshot)
    return (
      <p className="text-ink-2 p-4" data-e-loading="">
        {props.empty?.says ?? "reading ducts…"}
      </p>
    );
  if (props.pricing)
    return (
      <p className="text-ink-2 p-4" data-e-pricing>
        read {props.snapshot.document.title} ({props.snapshot.systems.length} systems) · pricing
        every run…
      </p>
    );
  return (
    <OpeningContext value={opening}>
      <HeldBody props={shown.current.snapshot ? shown.current : props} />
    </OpeningContext>
  );
}

const HeldBody = memo(EScreenBody);

function EScreenBody({ props }: { props: ProtoProps }) {
  if (!props.snapshot)
    return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;
  return (
    <LoadedScreenBody
      props={props as ProtoProps & { snapshot: NonNullable<ProtoProps["snapshot"]> }}
    />
  );
}

/** Loading is outside this component so every loaded render calls the same hooks. */
function LoadedScreenBody({
  props,
}: {
  props: ProtoProps & { snapshot: NonNullable<ProtoProps["snapshot"]> };
}) {
  const { snapshot, priced, page, setPage } = props;
  const doc = props.work.doc;
  const work = useMemo<LossesWork>(
    () => ({
      doc,
      revision: props.work.revision,
      preview: props.work.preview as LossesWork["preview"],
      write: props.work.write as unknown as LossesWork["write"],
    }),
    [doc, props.work.revision, props.work.preview, props.work.write],
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
  const scope = useMemo(() => (drawn ? scopeOf(drawn, page.system) : null), [drawn, page.system]);
  const groups = scope?.groups ?? NO_GROUPS;
  // The drawing indexes the raw snapshot: a group the survey merged away is drawn by its raw id too.
  const drawGroups = useMemo(() => {
    if (!snapshot || !page.system) return groups;
    const raw = systemScope(snapshot, page.system).groups;
    return raw.every((g) => groups.includes(g)) ? groups : [...new Set([...groups, ...raw])];
  }, [snapshot, page.system, groups]);
  const systems = useMemo(() => (drawn ? systemList(drawn, priced) : []), [drawn, priced]);
  // Each group the system is in is its own section, named by the system and its units; a group
  // that carries other systems says so, and shows whole.
  const sections = useMemo(
    () => (drawn && scope ? sectionNames(drawn, scope.name) : new Map<string, string>()),
    [drawn, scope],
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
    () => (drawn && scope ? buildTree(drawn, priced, doc, groups, sectionOf) : []),
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
  const preview = props.work.preview as DuctsApply.Res.Response | null;
  // What heals in Revit is planned over the raw snapshot (the tolerated one has bridged it already).
  const heal = useMemo(() => (snapshot ? healPlan(snapshot, doc) : null), [snapshot, doc]);
  const needsFix = useMemo(
    () => (surveyed ? systemsNeedingFix(surveyed, doc, heal) : new Set<string>()),
    [surveyed, doc, heal],
  );
  // The document at a glance: how many systems price clean, and how many a person must fix first.
  const census = useMemo(() => {
    const issues = systems.map((s) => systemIssues({ ...s, needsFix: needsFix.has(s.key) }));
    return {
      systems: systems.length,
      priced: systems.filter((s) => s.total != null).length,
      fix: issues.filter((i) => i.some((x) => x.tone === "alarm")).length,
    };
  }, [systems]);
  const chosenRow = useMemo(() => {
    const row = systems.find((s) => s.key === page.system);
    return row ? { ...row, needsFix: needsFix.has(row.key) } : null;
  }, [systems, page.system, needsFix]);
  const healRun = useMemo(
    () =>
      page.heal && surveyed
        ? healRunView(
            page.heal,
            surveyed.snapshot,
            page.epoch,
            (g) => priced?.next.byGroup[g]?.fan ?? null,
          )
        : null,
    [page.heal, page.epoch, surveyed, priced],
  );
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
            healRun,
            airflow: airflowOptions(surveyed.snapshot, scope),
            unitAirflow: airflowOptions(surveyed.snapshot, scope, "unit"),
            roles: surveyed.roles,
            fan: { run: page.fan, epoch: page.epoch },
            claims: props.claims,
            write: {
              staged: props.staged,
              hasPreview: page.evaluation !== null,
              fresh: previewFresh(page, props.work.revision),
              planned: preview?.counts.planned ?? null,
              refused: preview?.counts.refused ?? null,
              esp: stagedEsp(doc),
            },
          })
        : null,
    [
      surveyed,
      scope,
      page.fan,
      page.epoch,
      page.evaluation,
      doc,
      nameOf,
      groupLabel,
      heal,
      healRun,
      props.claims,
      props.staged,
      props.work.revision,
      preview,
    ],
  );
  const inbox = useMemo(
    () => baseInbox && { ...baseInbox, diagnostics: [...baseInbox.diagnostics, ...noRunRows] },
    [baseInbox, noRunRows],
  );
  // A unit whose role is fan while no Revit system names it base equipment offers to make it one.
  const fanHandles = useMemo<FanVerbs>(
    () => ({
      preview: props.actions.fanPreview,
      apply: props.actions.fan,
      busy: props.actions.busy,
    }),
    [props.actions.fanPreview, props.actions.fan, props.actions.busy],
  );
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
        .filter((a) => !scope || a.system === scope.name)
        .flatMap((a) => fanVerbs(a, nameOf, { run: page.fan, epoch: page.epoch }));
      const split = [...(owedBase.split ?? [])].find(
        ([system, units]) => (!scope || system === scope.name) && units.includes(id),
      );
      if (!verbs.length && split)
        return (
          <span className="t-small text-ink-2" data-e-fan-split={split[0]}>
            {`${split[0]} spans separate networks with their own fans (${split[1].map((u) => nameOf(u)).join(", ")}); Revit gives a system one fan, so split ${split[0]} in Revit first`}
          </span>
        );
      if (!verbs.length) return null;
      const outcome = verbs.find((v) => v.outcome)?.outcome ?? null;
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
          {outcome ? (
            <span className="t-small text-ink-2" data-e-fan-outcome="">
              {outcome}
            </span>
          ) : null}
        </span>
      );
    },
    [owedBase, scope, nameOf, page.fan, page.epoch, fanHandles],
  );
  // The Write popover holds only a preview that still describes this Work and snapshot.
  const writeHeld = useMemo(
    () =>
      preview && previewFresh(page, props.work.revision)
        ? writePreview(preview, reviewLines(preview, nameOf))
        : null,
    [preview, page, props.work.revision, nameOf],
  );
  const toRule = inbox ? inbox.fix.length + inbox.set.length + inbox.check.length : 0;
  // A Set row's verb selects the element and focuses its cell once the tree has drawn it.
  const [sideFor, setSideFor] = useState<{ system: string; side: Side }>({
    system: "",
    side: "left",
  });
  // A fitting's drop cell the inbox asked for, in the rules half that holds it.
  const [landing, setLanding] = useState<{ id: number; half: "all" | "this" } | null>(null);
  const [cellFocus, setCellFocus] = useState<CellRef | null>(null);
  const [inputsOpen, setInputsOpen] = useState(false);
  // The rules pane lands on the cell: scroll it in, focus its control, mark it once (`--motion-land`).
  useEffect(() => {
    if (!landing) return;
    const half = document.querySelector(`[data-e-rules="${landing.half}"]`);
    const row =
      half?.querySelector<HTMLElement>(`[data-e-unruled-ids~="${landing.id}"]`) ??
      half?.querySelector<HTMLElement>(`[data-e-cell="componentDrops:${landing.id}"]`);
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    row.querySelector<HTMLElement>("input, select")?.focus();
    row.setAttribute("data-landed", "");
    const done = window.setTimeout(() => row.removeAttribute("data-landed"), 1600);
    setLanding(null);
    return () => window.clearTimeout(done);
  }, [landing, priced, sideFor]);
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
  // Hover never sets screen state: the reach store re-renders only what draws it.
  const [reach] = useState(reachStore);
  const subjectProps = useRevitSubjectProps();
  useEffect(
    () => reach.set((state) => ({ ...state, lighting: NO_LIGHTING })),
    [reach, snapshot, page.system, page.picture],
  );
  // Lit Subjects carried out of a text stay lit while the pointer keeps moving over the picture
  // (`hold`), so it can reach their badges (about 500 px from the inbox on Chadds EX 19); they go
  // dark 700 ms after it stops or leaves. Any light cancels a pending clear.
  const clearing = useRef<{ timer?: ReturnType<typeof setTimeout>; owner?: string }>({});
  useEffect(() => () => clearTimeout(clearing.current.timer), []);
  const clearSubjects = useCallback(
    (owner: string) => {
      clearTimeout(clearing.current.timer);
      clearing.current = {
        owner,
        timer: setTimeout(() => {
          clearing.current = {};
          reach.set((state) =>
            state.lighting.owner === owner ? { ...state, lighting: NO_LIGHTING } : state,
          );
        }, 700),
      };
    },
    [reach],
  );
  const holdSubjects = useCallback(() => {
    const { owner } = clearing.current;
    if (owner) clearSubjects(owner);
  }, [clearSubjects]);
  const lightSubjects = useCallback(
    (
      references: readonly SubjectReference[],
      focus: number | null,
      owner?: string,
      ids: readonly number[] = [],
    ) => {
      clearTimeout(clearing.current.timer);
      clearing.current = {};
      const tinted = new Set(focus == null ? [...ids, ...references.map((r) => r.id)] : [focus]);
      reach.set((state) => {
        const current = state.lighting;
        const same =
          current.owner === owner &&
          current.focus === focus &&
          current.ids.size === tinted.size &&
          current.references.length === references.length &&
          current.references.every(
            (r, i) => r.id === references[i]?.id && r.number === references[i]?.number,
          );
        return same && state.hovered === null
          ? state
          : {
              ...state,
              hovered: null,
              lighting: same ? current : { ids: tinted, references, focus, owner },
            };
      });
    },
    [reach],
  );
  const setHovered = useCallback(
    (hovered: number | null) =>
      reach.set((state) => (state.hovered === hovered ? state : { ...state, hovered })),
    [reach],
  );
  const setHoveredIssue = useCallback(
    (issue: string | null) =>
      reach.set((state) => (state.issue === issue ? state : { ...state, issue })),
    [reach],
  );
  const issues = useMemo(() => (inbox ? stageIssues(inbox) : []), [inbox]);
  // The picture's alias jump: selection and the view that shows it, one Page write.
  const jump = useRef<((id: number) => void) | null>(null);
  // Stable, so memoized panes that only light (the rules) skip a selection's render.
  const light = useCallback(
    (ids: readonly number[] | null) =>
      reach.set((state) =>
        !ids?.length && !state.lighting.ids.size && state.hovered === null
          ? state
          : {
              ...state,
              lighting: { ids: new Set(ids ?? []), references: [], focus: null },
              hovered: ids?.[0] ?? null,
            },
      ),
    [reach],
  );
  const { epoch, system, systemSearch, systemSort } = page;
  const systemKeys = useMemo(
    () => ({ epoch, system, systemSearch, systemSort }),
    [epoch, system, systemSearch, systemSort],
  );
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  // null = automatic: open when the inbox holds a row, collapsed when it holds none.
  const [inboxOpen, setInboxOpen] = useState<boolean | null>(null);
  // A review from the chat head names an inbox row in `issue`: a rail-collapsed inbox opens for it.
  useEffect(() => {
    if (page.issue) setInboxOpen(true);
  }, [page.issue]);
  // null = automatic: the sidebar is a rail while the screen is tight.
  const [treeCollapsed, setTreeCollapsed] = useState<boolean | null>(null);
  const [panePriority, setPanePriority] = useState<"sidebar" | "inbox">("sidebar");
  const [rootRef, width] = useWidth();
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
  // Both panes project one choice, including programmatic landings and system changes.
  const home: Side = chosen ? "right" : "left";
  const side = chosen && sideFor.system === page.system ? sideFor.side : home;
  const pick = useCallback(
    (side: Side) => setSideFor({ system: page.system, side }),
    [page.system],
  );

  const select = useCallback(
    (id: number | null) => (id != null && jump.current ? jump.current(id) : props.onSelect(id)),
    [props.onSelect],
  );
  // The critical run is the largest priced total over every section: the worst fan's run (B's
  // model marks Pe's only when the group solve names one; a provisional solve can leave it
  // unnamed, so the largest total stands in). Only the runs that price the system count: a shared
  // group's other runs never lead. Header, tree and fan rows read one solve, `next`: the model
  // plus the staged cells, what the person is looking at while staging.
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
  // A narrow screen keeps the inbox a rail until it is asked for.
  const open =
    inboxOpen ?? ((width === 0 || width >= NARROW_PX) && (toRule > 0 || props.staged > 0));
  // Admit the last requested support pane when both would consume the picture's navigation field.
  const sidebarWanted = !(treeCollapsed ?? (width > 0 && width < TIGHT_PX));
  const cramped = width > 0 && width < 280 + 260 + 360 + 16;
  const sidebarCollapsed = !sidebarWanted || (cramped && open && panePriority === "inbox");
  const inboxShown = open && !(cramped && sidebarWanted && panePriority === "sidebar");
  // A cell outside the system (a Set row on the whole document) moves the page to its system.
  const focusCell = useCallback(
    (cell: CellRef) => {
      if (cell.segment === "componentDrops") {
        // A fitting's drop lives in the bottom pane, in the half whose scope holds it. Nothing is
        // selected and the page does not move: the picture and its orbit stay as they were.
        const group = (drawn ?? snapshot).nodes.find((n) => n.id === cell.id)?.groupId;
        const mine = chosen && group != null && groups.includes(group);
        pick(mine ? "right" : "left");
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
              return g ? systemOfGroup(drawn ?? snapshot, g) : page.system;
            })();
      if (into === page.system && jump.current) jump.current(cell.id);
      else setPage({ system: into, selected: String(cell.id), issue: "" });
      setSideFor({ system: into, side: "right" });
      setInputsOpen(true);
      setCellFocus(cell);
    },
    [drawn, snapshot, chosen, groups, scope, page.system, pick, setPage],
  );
  // The section whose run leads the system: its fan and TEL head the pane.
  const leadGroup =
    tree?.find((t) => critical && t.children.includes(critical))?.key ??
    groups.find((g) => scope?.pricing.has(g)) ??
    groups[0] ??
    "";
  // Any group of the system with an implausible row: its ESP is a partial sum, so none is shown.
  const blockedLoss = groups.some((g) => (priced?.next.byGroup[g]?.implausible.length ?? 0) > 0);
  const fansOf = useCallback(
    (system: ReturnType<typeof systemList>[number]) => fanFacts(priced, system.groups, nameOf),
    [priced, nameOf],
  );
  jumpToRuleNow.current = (key) => {
    setRuleFocus(key);
    pick("right");
  };
  const designRate = priced?.staged.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  // The tree is the whole pane (kaitpw 2026-10-23: the header block "only takes up space", the
  // selected row's footer "obscures the tree"): the system's name and way back live in the picture
  // title, its state in the plate, its fans in the breakdown popover and on Inputs' unit rows, and
  // the selection's facts in the picture.
  const treePane = useMemo(
    () =>
      tree ? (
        <Pane id="e-sidebar" scroll="auto" flush>
          <div className="min-w-0 shrink-0" onMouseLeave={() => light(null)}>
            <SystemTree
              key={scope?.name}
              address={{
                scope: `${page.system}:${page.epoch}`,
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
                light,
                select,
                jumpToRule,
                reading,
                designRate,
              }}
            />
          </div>
        </Pane>
      ) : null,
    [
      tree,
      scope?.name,
      page.system,
      page.epoch,
      page.treeSearch,
      page.treeSort,
      setPage,
      scale,
      critical?.key,
      grilleName,
      selected,
      ruleOf,
      light,
      select,
      jumpToRule,
      reading,
      designRate,
    ],
  );
  const systemsPane = (
    <Pane
      id="e-systems"
      title="Systems"
      meta={`${census.systems} · ${census.priced} priced · ${census.fix} need a fix`}
      scroll="auto"
      flush
    >
      <SystemsList
        systems={systems}
        fansOf={fansOf}
        nameOf={nameOf}
        needsFix={needsFix}
        drawn={drawn}
        page={systemKeys}
        setPage={setPage}
      />
    </Pane>
  );
  const rulesPane = (wide: boolean) => (
    <Pane
      id={wide ? "e-rules-all" : "e-rules"}
      title={wide ? "All-systems rules" : "This system's rules"}
      meta={wide ? "every system" : (scope?.name ?? "")}
      help="A rule is a fitting type (family : type) plus a geometry condition. Its table is the one choice a person makes; Pe re-looks-up every instance under it. A fitting with a stated drop is an override under its type."
      scroll="auto"
      flush
    >
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
          light={light}
        />
      ) : (
        <p className="text-ink-2 p-2">rules are read once the tables are in</p>
      )}
    </Pane>
  );
  const inputsCount = scope
    ? `${plural(scope.units.size, "unit")} · ${plural(scope.terminals.size, "grille")}`
    : "";
  const inputsPane = useMemo(
    () =>
      tree && scope ? (
        <Pane
          id="e-inputs"
          title="Inputs"
          meta={inputsCount}
          help="Each unit and grille of this system, named, with the cells you can type into. A typed value stages as an override and reprices."
          scroll="auto"
          flush
        >
          <p className="t-small text-ink-2 px-(--item-mark-pad-x) py-1">flow · ESP · role · drop</p>
          <InputsPane
            address={{
              scope: `${page.system}:${page.epoch}`,
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
            light={light}
          />
        </Pane>
      ) : null,
    [
      tree,
      scope,
      inputsCount,
      page.system,
      page.epoch,
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
      light,
    ],
  );
  const systemPane = (
    <PaneSplit
      axis="vertical"
      start={treePane}
      end={inputsPane}
      resize={{
        target: "end",
        defaultSize: 220,
        minSize: 100,
        minOtherSize: 100,
        persist: "proto-e-system-inputs",
        // A rail until asked for, so the tree keeps the sidebar's height; a Set row's cell opens it.
        collapse: {
          collapsed: !inputsOpen,
          onCollapsedChange: (collapsed) => setInputsOpen(!collapsed),
          collapsedSize: 32,
          collapseBelow: 80,
          title: `Inputs · ${inputsCount}`,
        },
      }}
    />
  );
  const noSystem = chosen ? undefined : "choose a system first";
  const left = (
    <PaneSplit
      axis="vertical"
      start={
        <Halves
          side={side}
          onSide={pick}
          left={{ title: "Systems", pane: systemsPane }}
          right={{ title: scope?.name ?? "System", pane: systemPane, refusal: noSystem }}
        />
      }
      end={
        <Halves
          side={side}
          onSide={pick}
          left={{ title: "All-systems rules", pane: rulesPane(true) }}
          right={{ title: "This system's rules", pane: rulesPane(false), refusal: noSystem }}
        />
      }
      resize={{
        target: "end",
        defaultSize: 176,
        minSize: 64,
        minOtherSize: 200,
        persist: "proto-e-stack",
      }}
    />
  );

  // The inbox header says what holds the system's ESP back, not only how many rows wait.
  const held = inbox ? holding(inbox.fix) + inbox.set.length : 0;
  const rulingsWord = !chosen
    ? `${toRule} to rule on · every system`
    : blockedLoss
      ? "no ESP: an implausible loss"
      : held
        ? `ESP held by ${[
            inbox && holding(inbox.fix) ? `${holding(inbox.fix)} fix` : "",
            inbox?.set.length ? `${inbox.set.length} set` : "",
          ]
            .filter(Boolean)
            .join(" · ")}${inbox?.check.length ? ` · ${inbox.check.length} to check` : ""}`
        : inbox?.check.length
          ? `${inbox.check.length} to check · nothing holds the ESP`
          : "nothing holds the ESP";
  const inboxPane = useMemo(
    () => (
      <Pane
        id="e-inbox"
        title="Rulings"
        meta={rulingsWord}
        actions={
          <Button label="hide rulings" onClick={() => setInboxOpen(false)}>
            hide
          </Button>
        }
        flush
      >
        {inbox ? (
          <ReachInbox
            groups={inbox}
            work={inboxWork}
            nameOf={nameOf}
            onVerdict={props.onVerdict}
            light={light}
            onSelect={select}
            onFocusCell={focusCell}
            write={{
              ...props.actions,
              row: inbox.write,
              held: writeHeld,
              stale: page.evaluation !== null && writeHeld === null,
            }}
            heal={{
              preview: props.actions.healPreview,
              apply: props.actions.heal,
              busy: props.actions.busy,
            }}
            fan={fanHandles}
            selected={selected}
            focused={focusKey}
            reach={reach}
            onIssueHover={setHoveredIssue}
            onPick={() => setPage({ issue: "" }, { history: "replace" })}
            address={{
              scope: `${page.system}:${page.epoch}`,
              search: page.rulingSearch,
              sort: page.rulingSort,
              onChange: (rulingSearch, rulingSort) =>
                setPage({ rulingSearch, rulingSort }, { history: "replace" }),
            }}
          />
        ) : null}
      </Pane>
    ),
    [
      rulingsWord,
      inbox,
      inboxWork,
      nameOf,
      props.onVerdict,
      light,
      select,
      focusCell,
      props.actions,
      writeHeld,
      page.evaluation,
      fanHandles,
      selected,
      focusKey,
      reach,
      setHoveredIssue,
      setPage,
      page.system,
      page.epoch,
      page.rulingSearch,
      page.rulingSort,
    ],
  );

  const subjectContext = useMemo(
    () => ({
      nameOf: subjectName,
      reach,
      light: lightSubjects,
      clear: clearSubjects,
      hold: holdSubjects,
      go: (id: number) => select(id),
      refProps: subjectProps,
    }),
    [subjectName, reach, lightSubjects, clearSubjects, holdSubjects, select, subjectProps],
  );

  return (
    <SubjectTextContext.Provider value={subjectContext}>
      <div ref={rootRef} data-proto="E2" className="flex size-full min-h-0">
        <BarRules snapshot={drawn!} work={work} priced={priced}>
          <DuctSettings work={work} rate={designRate} snapshot={snapshot} scope={scope} />
          <PaneSplit
            axis="horizontal"
            resize={{
              target: "start",
              defaultSize: 420,
              minSize: 280,
              maxSize: 760,
              // The picture keeps 360 beside the inbox rail; a tight screen starts with the sidebar a rail.
              minOtherSize: 392,
              persist: "proto-e-sidebar",
              collapse: {
                collapsed: sidebarCollapsed,
                onCollapsedChange: (collapsed) => {
                  if (!collapsed) setPanePriority("sidebar");
                  setTreeCollapsed(collapsed);
                },
                collapsedSize: 32,
                collapseBelow: 200,
                title: scope?.name ?? "systems",
              },
            }}
            start={left}
            end={
              <PaneSplit
                axis="horizontal"
                resize={{
                  target: "end",
                  defaultSize: 340,
                  minSize: 260,
                  maxSize: 520,
                  minOtherSize: width > 0 && width < TIGHT_PX ? 240 : 360,
                  persist: "proto-e-inbox",
                  collapse: {
                    collapsed: !inboxShown,
                    onCollapsedChange: (collapsed) => {
                      if (!collapsed) setPanePriority("inbox");
                      setInboxOpen(!collapsed);
                    },
                    collapsedSize: 32,
                    collapseBelow: 200,
                    title: `Rulings · ${toRule}`,
                  },
                }}
                start={
                  <div className="relative size-full min-w-0">
                    <ReachCanvas
                      {...props}
                      reach={reach}
                      onHover={setHovered}
                      issueScope={issueScope}
                      annotated={annotated}
                      issues={issues}
                      onIssueHover={setHoveredIssue}
                      scale={encoded}
                      nameOf={nameOf}
                      jump={jump}
                      groups={drawGroups}
                      lead={leadGroup}
                      identity={{
                        system: chosenRow,
                        census,
                        refreshing: props.reading.refreshing,
                        open: () => pick("right"),
                        breakdown:
                          (critical?.split ?? tree?.[0]?.split) && scale
                            ? {
                                split: (critical?.split ?? tree?.[0]?.split)!,
                                scale,
                                fans: () => (
                                  <FanFacts
                                    facts={fanFacts(priced, groups, nameOf)}
                                    nameOf={nameOf}
                                  />
                                ),
                              }
                            : null,
                        allSystems: () => setPage({ system: "", selected: "", issue: "" }),
                      }}
                    />
                  </div>
                }
                end={inboxPane}
              />
            }
          />
        </BarRules>
      </div>
    </SubjectTextContext.Provider>
  );
}

/** Keep query renders below the model, drawing and ruling builders. */
// Memoized on the Page keys it reads: a selection or a camera move never re-renders 355 rows.
const SystemsList = memo(function SystemsList({
  systems,
  fansOf,
  nameOf,
  needsFix,
  drawn,
  page,
  setPage,
}: {
  systems: ReturnType<typeof systemList>;
  /** The system's fans: its hover hint and the head of its breakdown popover. */
  fansOf: (system: ReturnType<typeof systemList>[number]) => FanFact[];
  nameOf: (id: number) => string;
  needsFix: ReadonlySet<string>;
  drawn: ProtoProps["snapshot"];
  page: Pick<ProtoProps["page"], "epoch" | "system" | "systemSearch" | "systemSort">;
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
  const systemListView = useList({
    scope: String(page.epoch),
    items: systems,
    keyOf: (system) => system.key,
    search,
    fields: {
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
        read: (system) => (needsFix.has(system.key) ? "yes" : "no"),
        values: ["yes", "no"],
        labels: new Map([
          ["yes", "Yes"],
          ["no", "No"],
        ]),
      },
    },
    sorts: { name: (system) => system.name, loss: (system) => -(system.total ?? -Infinity) },
    state: {
      ...emptyListState<"name" | "loss">(),
      search: page.systemSearch,
      sort: page.systemSort,
      selected: page.system ? [page.system] : [],
    },
    onState: (next) => {
      if (next.search !== page.systemSearch || next.sort !== page.systemSort)
        setPage({ systemSearch: next.search, systemSort: next.sort }, { history: "replace" });
    },
    onPick: (system) => setPage({ system: system.key, selected: "", issue: "" }),
  });
  useEffect(() => {
    if (systemListView.target && systemListView.rows.some((row) => row.key === page.system))
      systemListView.reveal(page.system);
    // The selected system is revealed when its pane mounts; filtering never replaces the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.system, systemListView.target]);
  return (
    <ListView
      aria-label="systems"
      list={systemListView}
      primary
      estimate={LIST_ROW_PX}
      row={(system) => {
        const fans = fansOf(system);
        return systemRowParts(
          system,
          () => setPage({ system: system.key, selected: "", issue: "" }),
          needsFix.has(system.key),
          fans.map((f) => `${nameOf(f.unit)} ${f.role}: ${f.says}`),
          () => <FanFacts facts={fans} nameOf={nameOf} />,
        );
      }}
      empty={{
        message: "No duct systems in this scope",
        exit: "Read a model containing duct systems",
      }}
    />
  );
});

/** The picture redraws on every reach (lit rows, hovered element, hovered issue); the screen does not. */
function ReachCanvas({
  reach,
  ...props
}: Omit<ComponentProps<typeof ECanvas>, "lit" | "hovered" | "hoveredIssue"> & {
  reach: ReachStore;
}) {
  const state = useReach(reach, (s) => s);
  return (
    <ECanvas
      {...props}
      lit={state.lighting.ids}
      hovered={state.hovered}
      hoveredIssue={state.issue}
    />
  );
}

/** The inbox redraws only when the hovered issue (its rail) changes. */
function ReachInbox({
  reach,
  ...props
}: Omit<ComponentProps<typeof Inbox>, "hoveredIssue"> & { reach: ReachStore }) {
  const issue = useReach(reach, (s) => s.issue);
  return <Inbox {...props} hoveredIssue={issue} />;
}
