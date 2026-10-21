/**
 * THROWAWAY (protoui round 3): E2 ("C simplicity, B layout"). LEFT a resizable sidebar of two
 * sections, the system tree over the document's loss Rules; CENTRE C's full-bleed drawing with
 * numbered ruling pins and click popovers; RIGHT the inbox of rows a person has a verb on,
 * collapsed when it holds none. Hovering a row anywhere lights its element set on the drawing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RouteStatePatch } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";
import { survey } from "@pe/ducts-domain/survey";
import { healPlan } from "@pe/ducts-domain/heal";
import { sectionNames, systemOfGroup, systemScope } from "@pe/ducts-domain/system-scope";
import { Button } from "@pe/kit/lang/button";
import { Row } from "@pe/kit/lang/row";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";

import { airflowOptions } from "../../airflow";
import { elementNamer } from "../../claims";
import { healRunView, inboxRows, type CellRef } from "../../inbox-rows";
import { groupLabels } from "../../inputs";
import { previewFresh, scopeOf } from "../../manifest";
import type { LossesWork } from "../../work";
import { reviewLines } from "../../write-review";
import { buildTree, systemList, type TreeNode } from "../b/model";
import type { ProtoProps } from "../props";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { BarLegend, fmtFt, LossBar, SplitStrip } from "./bar";
import { DesignFrictionSettings } from "./design-friction";
import { FanSections } from "./fan-sections";
import { RunDetail, runOf } from "./run-detail";
import { ECanvas } from "./canvas";
import { grilleLabels } from "./labels";
import { Inbox } from "./inbox";
import { InputsPane } from "./inputs-pane";
import { RulesTree, ruleOfIds } from "./rules-pane";
import { SystemTree } from "./tree-sidebar";
import { useGroupEncoding } from "../encoding/use-encoding";
import { formatQuantity } from "../../encoding";

const NO_GROUPS: readonly string[] = [];

/**
 * The read snapshot is priced once the tables are in (2-3 s on a large model): until then the
 * screen says so instead of holding the first paint.
 */
export function EScreen({ props }: { props: ProtoProps }) {
  if (!props.snapshot)
    return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;
  if (props.pricing)
    return (
      <p className="text-ink-2 p-4" data-e-pricing>
        pricing…
      </p>
    );
  return <EScreenBody props={props} />;
}

function EScreenBody({ props }: { props: ProtoProps }) {
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
      write: props.work.write as unknown as (p: RouteStatePatch[]) => Promise<unknown>,
      store: snapshot?.store ?? null,
    }),
    [doc, props.work.revision, props.work.write, snapshot],
  );
  const ruleOf = useMemo(() => ruleOfIds(priced), [priced]);
  // The tree draws the topology that was priced (bridged joins, phase filter); the raw one left the
  // fan-setting run out (g8745870: header 0.186, tree critical 0.109). Healing still plans on raw.
  const drawn = priced?.snapshot ?? snapshot;
  // The subject is a Revit system: every group it is in, over the snapshot that was priced.
  const scope = useMemo(() => (drawn ? scopeOf(drawn, page) : null), [drawn, page.system]);
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
  const nameOf = useMemo(() => {
    const n = snapshot ? elementNamer(snapshot, null) : () => null;
    return (id: number) => labels.get(id) ?? n(id) ?? "element not in snapshot";
  }, [snapshot, labels]);
  // A row names a group the way the system reads it, else by its systems and units; never its id.
  const names = useMemo(
    () => (drawn ? groupLabels(drawn) : new Map<string, string>()),
    [drawn],
  );
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
  // The subject is a system name, so a heal that renumbers its groups leaves the page where it was.
  const inbox = useMemo(
    () =>
      surveyed
        ? inboxRows({
            snapshot: surveyed.snapshot,
            scope,
            findings: surveyed.findings,
            flows: surveyed.flows,
            equipmentFlows: surveyed.equipmentFlows,
            doc,
            nameOf,
            groupLabel,
            heal,
            healRun,
            airflow: airflowOptions(surveyed.snapshot, scope),
            unitAirflow: airflowOptions(surveyed.snapshot, scope, "unit"),
            roles: surveyed.roles,
            claims: props.claims,
            write: {
              staged: props.staged,
              hasPreview: page.evaluation !== null,
              fresh: previewFresh(page, props.work.revision),
              planned: preview?.counts.planned ?? null,
              refused: preview?.counts.refused ?? null,
            },
          })
        : null,
    [
      surveyed,
      scope,
      page,
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
  // The review lists only a preview that still describes this Work and snapshot.
  const review = useMemo(
    () => (preview && previewFresh(page, props.work.revision) ? reviewLines(preview, nameOf) : []),
    [preview, page, props.work.revision, nameOf],
  );
  const toRule = inbox ? inbox.fix.length + inbox.set.length + inbox.check.length : 0;
  // A Set row's verb selects the element and focuses its cell once the tree has drawn it.
  const [cellFocus, setCellFocus] = useState<CellRef | null>(null);
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
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  const [wideRules, setWideRules] = useState(false);
  // null = automatic: open when the inbox holds a row, collapsed when it holds none.
  const [inboxOpen, setInboxOpen] = useState<boolean | null>(null);

  if (!snapshot) return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;
  const tree = trees.length ? trees : null;

  const light = (ids: readonly number[] | null) => {
    setLit(new Set(ids ?? []));
    props.onHover(ids?.[0] ?? null);
  };
  const select = (id: number | null) => props.onSelect(id);
  // The critical run is the largest priced total over every section (B's model marks Pe's only
  // when the group solve names one; a provisional solve can leave it unnamed, so the largest total
  // stands in). Only the runs that price the system count: a shared group's other runs never lead.
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
  const open = inboxOpen ?? (toRule > 0 || props.staged > 0);
  // A cell outside the system (a Set row on the whole document) moves the page to its system.
  const focusCell = (cell: CellRef) => {
    const into =
      scope && (scope.members.has(cell.id) || scope.units.has(cell.id))
        ? page.system
        : (() => {
            const node = snapshot.nodes.find((n) => n.id === cell.id);
            const g = node?.groupId ?? snapshot.groups.find((x) => x.rootIds.includes(cell.id))?.id;
            return g ? systemOfGroup(drawn ?? snapshot, g) : page.system;
          })();
    setPage({ system: into, selected: String(cell.id), issue: "" });
    setCellFocus(cell);
  };
  // The section whose run leads the system: its fan and TEL head the pane.
  const leadGroup =
    tree?.find((t) => critical && t.children.includes(critical))?.key ??
    groups.find((g) => scope?.pricing.has(g)) ??
    groups[0] ??
    "";
  const groupFan = leadGroup ? priced?.now.byGroup[leadGroup]?.fan : undefined;
  const grilleName = (n: TreeNode) => {
    const id = n.kind === "run" ? n.terminal : n.id;
    return (id != null ? labels.get(id) : undefined) ?? n.name;
  };
  // The path header: the critical path's total effective length in feet, and the ESP in in-wg.
  const designRate = priced?.staged.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  const groupTel = leadGroup ? priced?.now.byGroup[leadGroup]?.criticalTel : undefined;
  const pricedWord = priced
    ? groupFan == null || critical?.total == null
      ? "this system is not priced"
      : `TEL ${fmtFt(critical.ft ?? groupTel)} ft · ESP ${critical.total.toFixed(3)} in-wg`
    : "pricing…";
  const runDetail =
    priced && scope && selected != null ? runOf(priced, groups, selected) : null;

  const head = (
    <span className="inline-flex gap-1">
      <DesignFrictionSettings work={work} rate={designRate} />
      {page.system ? (
        <Button
          label="show every system"
          onClick={() => setPage({ system: "", selected: "", issue: "" })}
        >
          all systems
        </Button>
      ) : null}
    </span>
  );
  const treePane = (
    <Pane
      id="e-sidebar"
      title={tree && scope ? scope.name : "systems"}
      meta={tree ? pricedWord : `${systems.length} in the document`}
      actions={head}
      scroll="auto"
      flush
    >
      {tree ? (
        <>
          {reading?.quantity ? (
            <p
              className="t-small text-ink-2 border-line border-b px-2 py-1"
              data-e-legend={reading.key}
            >
              bar = {reading.label}, {reading.quantity.unit}, the largest under each row · full
              width = the system's max{" "}
              <span className="face-mono">
                {reading.quantity.max == null
                  ? "—"
                  : formatQuantity(reading.quantity, reading.quantity.max)}
              </span>{" "}
              at{" "}
              {reading.quantity.maxId == null
                ? "no element"
                : encoded.nameOf(reading.quantity.maxId)}
            </p>
          ) : (
            <>
              <BarLegend scale={scale} criticalName={critical ? grilleName(critical) : null} />
              <SplitStrip
                split={critical?.split ?? tree[0]!.split}
                scale={scale}
                light={light}
              />
            </>
          )}
          {/* A multi-fan group: one row per fan, as staged (`next`), each with its TEL and ESP;
              each group the system is in carries its own, under its section's name. */}
          {tree.map((t) => (
            <FanSections
              key={t.key}
              title={tree.length > 1 ? t.name : null}
              fans={priced?.next.byGroup[t.key]?.fans ?? []}
              nameOf={nameOf}
              light={light}
              select={select}
            />
          ))}
          <div className="flex min-h-0 flex-1 flex-col" onMouseLeave={() => light(null)}>
            <SystemTree
              key={scope?.name}
              ctx={{
                trees: tree,
                scale,
                criticalKey: critical?.key ?? null,
                grilleName,
                selected,
                ruleOf,
                light,
                select,
                jumpToRule: setRuleFocus,
                reading,
                designRate,
              }}
            />
          </div>
          {runDetail ? (
            <RunDetail run={runDetail} designRate={designRate} nameOf={nameOf} light={light} />
          ) : null}
        </>
      ) : (
        <div role="list" aria-label="systems">
          {systems.map((s) => {
            const open = () => setPage({ system: s.key, selected: "", issue: "" });
            // A system none of whose groups has an air mover prices nothing: its row says it needs a fix.
            const fanless = s.fanless;
            return (
              <Row
                key={s.key}
                role="listitem"
                tabIndex={0}
                lines={2}
                label={s.name}
                sub={s.sub}
                title={`${s.name} · ${s.sub}`}
                meta={
                  fanless ? (
                    <span data-tone="alarm" data-e-fanless={s.key}>
                      needs a fix: no fan
                    </span>
                  ) : (
                    <LossBar
                      value={s.total}
                      scale={null}
                      provisional={s.provisional}
                      label="fan static Pe computes, in-wg"
                    />
                  )
                }
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open();
                }}
              />
            );
          })}
        </div>
      )}
    </Pane>
  );
  const rulesPane =
    tree && priced ? (
      <Pane
        id="e-rules"
        title="Rules"
        meta={wideRules ? "every system" : "this system"}
        help="A rule is a fitting type (family : type) plus a geometry condition. Its table is the one choice a person makes; Pe re-looks-up every instance under it. A fitting with a stated drop is an override under its type."
        actions={
          <Button
            label={wideRules ? "rules of this system only" : "rules of every system"}
            onClick={() => setWideRules(!wideRules)}
          >
            {wideRules ? "this system" : "all systems"}
          </Button>
        }
        scroll="clip"
        flush
      >
        <RulesTree
          snapshot={drawn ?? snapshot}
          priced={priced}
          groups={groups}
          wide={wideRules}
          work={work}
          focus={ruleFocus}
          onFocus={setRuleFocus}
          nameOf={nameOf}
          light={light}
        />
      </Pane>
    ) : null;
  const inputsPane =
    tree && scope ? (
      <Pane
        id="e-inputs"
        title="Inputs"
        meta="flow · ESP · role · drop"
        help="Each unit and grille of this system, named, with the cells you can type into. A typed value stages as an override and reprices."
        scroll="auto"
        flush
      >
        <InputsPane
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
    ) : null;
  const lower =
    !inputsPane && !rulesPane ? null : (
      <PaneSplit
        axis="vertical"
        start={inputsPane}
        end={rulesPane}
        resize={{
          target: "end",
          defaultSize: 220,
          minSize: 100,
          minOtherSize: 100,
          persist: "proto-e-inputs",
        }}
      />
    );
  const left = (
    <PaneSplit
      axis="vertical"
      start={treePane}
      end={lower}
      resize={{
        target: "end",
        defaultSize: 300,
        minSize: 120,
        minOtherSize: 160,
        persist: "proto-e-rules",
      }}
    />
  );

  const right = open ? (
    <div className="border-line flex w-[340px] shrink-0 flex-col border-l">
      <Pane
        id="e-inbox"
        title="Inbox"
        meta={`${toRule} to rule on`}
        actions={
          <Button label="hide the inbox" onClick={() => setInboxOpen(false)}>
            hide
          </Button>
        }
        flush
      >
        {inbox ? (
          <Inbox
            groups={inbox}
            work={inboxWork}
            doc={props.doc}
            nameOf={nameOf}
            onVerdict={props.onVerdict}
            light={light}
            onSelect={select}
            onFocusCell={focusCell}
            write={{ ...props.actions, row: inbox.write, review }}
            heal={{
              preview: props.actions.healPreview,
              apply: props.actions.heal,
              busy: props.actions.busy,
            }}
          />
        ) : null}
      </Pane>
    </div>
  ) : (
    <div
      data-e-inbox-rail={toRule}
      className="border-line flex shrink-0 justify-center border-l py-1 [writing-mode:vertical-rl]"
    >
      <Button label="show the inbox" onClick={() => setInboxOpen(true)}>
        Inbox · {toRule}
      </Button>
    </div>
  );

  return (
    <div data-proto="E2" className="flex size-full min-h-0">
      <PaneSplit
        axis="horizontal"
        resize={{
          target: "start",
          defaultSize: 420,
          minSize: 280,
          maxSize: 760,
          minOtherSize: 600,
          persist: "proto-e-sidebar",
        }}
        start={left}
        end={
          <div className="flex size-full min-h-0">
            <div className="relative min-w-0 flex-1">
              <ECanvas
                {...props}
                lit={lit}
                issueScope={issueScope}
                scale={encoded}
                groups={drawGroups}
                lead={leadGroup}
              />
            </div>
            {right}
          </div>
        }
      />
    </div>
  );
}
