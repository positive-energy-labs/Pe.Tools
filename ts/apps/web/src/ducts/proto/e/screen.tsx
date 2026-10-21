/**
 * THROWAWAY (protoui round 3): E2 ("C simplicity, B layout"). LEFT a resizable sidebar of two
 * sections, the system tree over the document's loss Rules; CENTRE C's full-bleed drawing with
 * numbered ruling pins and click popovers; RIGHT the inbox of rows a person has a verb on,
 * collapsed when it holds none. Hovering a row anywhere lights its element set on the drawing.
 */
import { useEffect, useMemo, useState } from "react";
import type { RouteStatePatch } from "@pe/agent-contracts";
import type { DuctsApply } from "@pe/host-contracts/generated";
import { survey } from "@pe/ducts-domain/survey";
import { healPlan } from "@pe/ducts-domain/heal";
import { Button } from "@pe/kit/lang/button";
import { Row } from "@pe/kit/lang/row";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";

import { airflowOptions } from "../../airflow";
import { elementNamer } from "../../claims";
import { healRunView, inboxRows, type CellRef } from "../../inbox-rows";
import { groupLabels } from "../../inputs";
import { previewFresh } from "../../manifest";
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

export function EScreen({ props }: { props: ProtoProps }) {
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
  const tree = useMemo(
    () => (drawn && page.group ? (buildTree(drawn, priced, doc, page.group)[0] ?? null) : null),
    [drawn, priced, doc, page.group],
  );
  const issueScope = useMemo(
    () =>
      snapshot && page.group
        ? new Set(snapshot.groups.find((g) => g.id === page.group)?.issueIds ?? [])
        : null,
    [snapshot, page.group],
  );
  const labels = useMemo(
    () => (drawn && tree ? grilleLabels(drawn, tree.children) : new Map<number, string>()),
    [drawn, tree],
  );
  const nameOf = useMemo(() => {
    const n = snapshot ? elementNamer(snapshot, null) : () => null;
    return (id: number) => labels.get(id) ?? n(id) ?? "element not in snapshot";
  }, [snapshot, labels]);
  const names = useMemo(
    () => (snapshot ? groupLabels(snapshot) : new Map<string, string>()),
    [snapshot],
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
  // Revit renumbers what a heal rebuilt: a subject group that is gone follows the healed group.
  useEffect(() => {
    if (!snapshot || !healRun || healRun.mode !== "apply" || page.group !== page.heal?.group)
      return;
    if (healRun.group !== page.group && !snapshot.groups.some((g) => g.id === page.group))
      setPage({ group: healRun.group });
  }, [snapshot, healRun, page.group, page.heal, setPage]);
  const inbox = useMemo(
    () =>
      surveyed
        ? inboxRows({
            snapshot: surveyed.snapshot,
            group: page.group,
            findings: surveyed.findings,
            flows: surveyed.flows,
            equipmentFlows: surveyed.equipmentFlows,
            doc,
            nameOf,
            groupLabel: (id) => names.get(id) ?? id,
            heal,
            healRun,
            airflow: snapshot ? airflowOptions(snapshot, page.group) : undefined,
            unitAirflow: snapshot ? airflowOptions(snapshot, page.group, "unit") : undefined,
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
      snapshot,
      page,
      doc,
      nameOf,
      names,
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
  }, [cellFocus, tree, priced]);
  const encoded = useGroupEncoding(snapshot, priced, page.group, page.encoding);
  // The tree reads the drawing's quantity; a categorical reading (or none) keeps Pe's fan-to-here loss.
  const reading = encoded.encoding.quantity ? encoded.encoding : null;
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  const [wideRules, setWideRules] = useState(false);
  // null = automatic: open when the inbox holds a row, collapsed when it holds none.
  const [inboxOpen, setInboxOpen] = useState<boolean | null>(null);

  if (!snapshot) return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;

  const light = (ids: readonly number[] | null) => {
    setLit(new Set(ids ?? []));
    props.onHover(ids?.[0] ?? null);
  };
  const select = (id: number | null) => props.onSelect(id);
  // The critical run is the largest priced total (B's model marks Pe's only when the group solve
  // names one; a provisional solve can leave it unnamed, so the largest total stands in).
  const critical =
    tree?.children.reduce<TreeNode | null>(
      (best, r) => (r.total != null && (best?.total == null || r.total > best.total) ? r : best),
      null,
    ) ?? null;
  const scale = critical?.total ?? null;
  const selected = page.selected && /^\d+$/.test(page.selected) ? Number(page.selected) : null;
  const open = inboxOpen ?? (toRule > 0 || props.staged > 0);
  const focusCell = (cell: CellRef) => {
    const group = snapshot.nodes.find((n) => n.id === cell.id)?.groupId ?? page.group;
    setPage({ group, selected: String(cell.id), issue: "" });
    setCellFocus(cell);
  };
  // The group's own fan (B's header read the document-wide one); unsolved says so.
  const groupFan = tree ? priced?.now.byGroup[tree.key]?.fan : undefined;
  const grilleName = (n: TreeNode) => {
    const id = n.kind === "run" ? n.terminal : n.id;
    return (id != null ? labels.get(id) : undefined) ?? n.name;
  };
  // The path header: the critical path's total effective length in feet, and the ESP in in-wg.
  const designRate = priced?.staged.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  const groupTel = tree ? priced?.now.byGroup[tree.key]?.criticalTel : undefined;
  const pricedWord = priced
    ? groupFan == null
      ? "this system is not priced"
      : `TEL ${fmtFt(groupTel)} ft · ESP ${groupFan.toFixed(3)} in-wg`
    : "not priced yet";
  const runDetail =
    priced && page.group && selected != null ? runOf(priced, page.group, selected) : null;

  const head = (
    <span className="inline-flex gap-1">
      <DesignFrictionSettings work={work} rate={designRate} />
      {page.group ? (
        <Button
          label="show every system"
          onClick={() => setPage({ group: "", selected: "", issue: "" })}
        >
          all systems
        </Button>
      ) : null}
    </span>
  );
  const treePane = (
    <Pane
      id="e-sidebar"
      title={tree ? "system" : "systems"}
      meta={tree ? pricedWord : `${snapshot.groups.length} in the document`}
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
              width = the group's max{" "}
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
              <SplitStrip split={critical?.split ?? tree.split} scale={scale} light={light} />
            </>
          )}
          {/* A multi-fan system: one section per fan, as staged (`next`), each with its TEL and ESP. */}
          <FanSections
            fans={priced?.next.byGroup[tree.key]?.fans ?? []}
            nameOf={nameOf}
            light={light}
            select={select}
          />
          <div className="flex min-h-0 flex-1 flex-col" onMouseLeave={() => light(null)}>
            <SystemTree
              key={tree.key}
              ctx={{
                tree,
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
          {systemList(snapshot, priced).map((s) => {
            const open = () => setPage({ group: s.key, selected: "", issue: "" });
            // A group with no air mover prices nothing: its row says it needs a fix (its Fix row).
            const fanless = priced?.now.byGroup[s.key]?.hasAirMover === false;
            return (
              <Row
                key={s.key}
                role="listitem"
                tabIndex={0}
                label={s.name}
                title={`${s.name} (${s.key})`}
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
          snapshot={snapshot}
          priced={priced}
          group={page.group}
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
    tree && page.group ? (
      <Pane
        id="e-inputs"
        title="Inputs"
        meta="flow · ESP · role · drop"
        help="Each unit and grille of this system, named, with the cells you can type into. A typed value stages as an override and reprices."
        scroll="auto"
        flush
      >
        <InputsPane
          snapshot={snapshot}
          priced={priced}
          work={work}
          group={page.group}
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
              <ECanvas {...props} lit={lit} issueScope={issueScope} scale={encoded} />
            </div>
            {right}
          </div>
        }
      />
    </div>
  );
}
