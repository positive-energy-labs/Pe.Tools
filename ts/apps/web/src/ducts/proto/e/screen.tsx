/**
 * THROWAWAY (protoui round 3): E2 ("C simplicity, B layout"). LEFT a resizable sidebar of two
 * sections, the system tree over the document's loss Rules; CENTRE C's full-bleed drawing with
 * numbered ruling pins and click popovers; RIGHT the inbox of rows a person has a verb on,
 * collapsed when it holds none. Hovering a row anywhere lights its element set on the drawing.
 */
import { useEffect, useMemo, useState } from "react";
import type { DuctsRouteDocument, RouteStatePatch } from "@pe/agent-contracts";
import { survey } from "@pe/ducts-domain/survey";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";

import { elementNamer, type Verdict } from "../../claims";
import { claimsOf } from "../../legs";
import type { Subject } from "../../spatial";
import type { LossesWork } from "../../losses-view";
import { buildTree, groupElementIds, systemList, type TreeNode } from "../b/model";
import type { ProtoProps } from "../props";
import { BarLegend, LossBar } from "./bar";
import { ECanvas } from "./canvas";
import { grilleLabels } from "./labels";
import { Inbox, inboxRows } from "./inbox";
import { RulesTree, ruleOfIds } from "./rules-pane";
import { SystemTree } from "./tree-sidebar";

// STAGED_WORK (fixture agent) lands at ../staged/work.ts; the glob is empty until it does.
const STAGED = import.meta.glob<{ STAGED_WORK?: Record<string, DuctsRouteDocument> }>(
  "../staged/work.ts",
);
function useStagedWork(): Record<string, DuctsRouteDocument> | null {
  const [work, setWork] = useState<Record<string, DuctsRouteDocument> | null>(null);
  useEffect(() => {
    const load = Object.values(STAGED)[0];
    if (load)
      void load()
        .then((m) => setWork(m.STAGED_WORK ?? null))
        .catch(() => setWork(null));
  }, []);
  return work;
}

export function EScreen({ props: routeProps }: { props: ProtoProps }) {
  const { snapshot, priced, page, setPage } = routeProps;
  // The route reads the ASHRAE tables (and prices) only for plan/iso/losses; the drawing is iso.
  useEffect(() => {
    if (page.view !== "iso") setPage({ view: "iso" });
  }, [page.view, setPage]);
  const staged = useStagedWork();
  // A group with an imitation Work (STAGED_WORK) draws its subject and claims; verdicts on them stay
  // local, since the route's Work holds none of those cells. Writes still go to the route's Work.
  // Never over the scene fixture: it stands in while the host reads, and holds none of these ids.
  const stagedDoc =
    page.group && !routeProps.fromFixture ? staged?.[page.group] : undefined;
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const stagedSubject = useMemo<Subject | null>(() => {
    if (!stagedDoc) return null;
    const cells = Object.fromEntries(
      Object.entries(stagedDoc.claims ?? {}).flatMap(([id, cell]) => {
        const value = cell.staged?.value ?? cell.proposal?.value;
        return value ? [[id, value] as const] : [];
      }),
    );
    return {
      ids: stagedDoc.subject?.staged?.value ?? stagedDoc.subject?.proposal?.value ?? [],
      claims: claimsOf(cells).map((c) => ({ ...c, verdict: verdicts[c.id] ?? c.verdict })),
      work: stagedDoc,
      onVerdict: (claim, verdict) => setVerdicts((was) => ({ ...was, [claim.id]: verdict })),
    };
  }, [stagedDoc, verdicts]);
  const props: ProtoProps = stagedSubject
    ? { ...routeProps, subject: stagedSubject, claims: stagedSubject.claims }
    : routeProps;
  const doc = stagedDoc ?? props.work.doc;
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
    }),
    [doc, props.work.revision, props.work.write],
  );
  const ruleOf = useMemo(() => ruleOfIds(priced), [priced]);
  const tree = useMemo(
    () => (snapshot && page.group ? (buildTree(snapshot, priced, doc, page.group)[0] ?? null) : null),
    [snapshot, priced, doc, page.group],
  );
  const scope = useMemo(
    () => (snapshot && page.group ? groupElementIds(snapshot, page.group) : null),
    [snapshot, page.group],
  );
  const issueScope = useMemo(
    () =>
      snapshot && page.group
        ? new Set(snapshot.groups.find((g) => g.id === page.group)?.issueIds ?? [])
        : null,
    [snapshot, page.group],
  );
  const findings = useMemo(
    () => priced?.findings ?? (snapshot ? survey(snapshot, doc).findings : []),
    [priced, snapshot, doc],
  );
  const rows = useMemo(
    () =>
      snapshot
        ? inboxRows({ snapshot, group: page.group, scope, findings, claims: props.claims })
        : [],
    [snapshot, page.group, scope, findings, props.claims],
  );
  const labels = useMemo(
    () => (snapshot && tree ? grilleLabels(snapshot, tree.children) : new Map<number, string>()),
    [snapshot, tree],
  );
  const nameOf = useMemo(() => {
    const n = snapshot ? elementNamer(snapshot, null) : () => null;
    return (id: number) => n(id) ?? "element not in snapshot";
  }, [snapshot]);
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  const [wideRules, setWideRules] = useState(false);
  // null = automatic: open when the inbox holds a row, collapsed when it holds none.
  const [inboxOpen, setInboxOpen] = useState<boolean | null>(null);

  if (!snapshot)
    return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;

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
  const open = inboxOpen ?? rows.length > 0;
  // The group's own fan (B's header read the document-wide one); unsolved says so.
  const groupFan = tree ? priced?.now.byGroup[tree.key]?.fan : undefined;
  const grilleName = (n: TreeNode) => {
    const id = n.kind === "run" ? n.terminal : n.id;
    return (id != null ? labels.get(id) : undefined) ?? n.name;
  };
  const pricedWord = priced
    ? groupFan == null
      ? "this system is not priced"
      : `fan ${groupFan.toFixed(3)} in-wg`
    : props.fromFixture
      ? "fixture, not priced"
      : "not priced yet";

  const head = (
    <span className="inline-flex gap-1">
      {page.group ? (
        <button
          type="button"
          className="cursor-pointer px-1"
          onClick={() => setPage({ group: "", selected: "", issue: "" })}
        >
          all systems
        </button>
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
          <BarLegend scale={scale} criticalName={critical ? grilleName(critical) : null} />
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
              }}
            />
          </div>
        </>
      ) : (
        <ol>
          {systemList(snapshot, priced).map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-(--pe-recess)"
                onClick={() => setPage({ group: s.key, selected: "", issue: "" })}
              >
                <span className="min-w-0 flex-1 break-words">{s.name}</span>
                <LossBar value={s.total} scale={null} provisional={s.provisional} label="Pe fan, in-wg" />
              </button>
            </li>
          ))}
        </ol>
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
          <button type="button" className="cursor-pointer px-1" onClick={() => setWideRules(!wideRules)}>
            {wideRules ? "this system" : "all systems"}
          </button>
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
  const left = (
    <PaneSplit
      axis="vertical"
      start={treePane}
      end={rulesPane}
      resize={{ target: "end", defaultSize: 300, minSize: 120, minOtherSize: 160, persist: "proto-e-rules" }}
    />
  );

  const right = open ? (
    <div className="border-line flex w-[340px] shrink-0 flex-col border-l">
      <Pane
        id="e-inbox"
        title="Inbox"
        meta={`${rows.length} to rule on`}
        actions={
          <button type="button" className="cursor-pointer px-1" onClick={() => setInboxOpen(false)}>
            hide
          </button>
        }
        flush
      >
        {rows.length ? (
          <Inbox
            rows={rows}
            work={inboxWork}
            doc={props.doc}
            nameOf={nameOf}
            onVerdict={props.subject?.onVerdict ?? null}
            light={light}
            onSelect={select}
          />
        ) : (
          <p className="text-ink-2 t-small px-2 py-1">nothing here has a verb for a person</p>
        )}
      </Pane>
    </div>
  ) : (
    <button
      type="button"
      data-e-inbox-rail={rows.length}
      className="border-line text-ink-2 cursor-pointer border-l px-1 [writing-mode:vertical-rl]"
      onClick={() => setInboxOpen(true)}
    >
      Inbox · {rows.length}
    </button>
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
              <ECanvas {...props} lit={lit} issueScope={issueScope} />
            </div>
            {right}
          </div>
        }
      />
    </div>
  );
}
