/**
 * T2 `ledger`: the engineer's worksheet, table first. Groups with their readiness; the chosen
 * group's runs from the root out to each terminal, Manual D style; its issues with the one
 * assumption editor this route has; and a plan-xy mini-map of the group with the active run
 * drawn dark. Assumptions stage into the `assumptions` Work only (Pea may propose the same
 * keys); nothing is written to Revit, and readiness re-derives from what is staged.
 */
import { useContext, useMemo } from "react";
import { type DuctsRouteDocument, type RouteStatePatch } from "@pe/agent-contracts";

import { AssumptionCell, NumericAssumptions } from "./assumptions";
import { PressureBudget, PressureIssues } from "./pressure-facts";
import { groupPressure } from "./pressure";
import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { tokenRef } from "#/lib/token";
import { ChatHosted } from "#/route/situation-ladder";
import { ISSUE_KINDS, IssueLegend, issueVerdict, type Blocks, type IssueKind } from "./issues";
import type { DuctsPage } from "./manifest";
import type { DuctSnapshot, GroupReadiness } from "./readiness";
import { READY } from "./tables";
import { groupTree, runsOf, type GroupTree, type Run } from "./topology";

type Issue = DuctSnapshot["issues"][number];

const num = (value: number | null | undefined, digits = 0) =>
  value == null ? "" : value.toFixed(digits);

const CLASS_ORDER: readonly Blocks[] = ["walkable", "budgetable", "none"];
/** Kinds in class-then-shade order, so counts read the same everywhere. */
const KIND_ORDER = (Object.keys(ISSUE_KINDS) as IssueKind[]).sort(
  (a, b) =>
    CLASS_ORDER.indexOf(ISSUE_KINDS[a].blocks) - CLASS_ORDER.indexOf(ISSUE_KINDS[b].blocks) ||
    ISSUE_KINDS[a].color.shade - ISSUE_KINDS[b].color.shade,
);

/** Issue counts by kind, each in its kind's tone: `3 open end · 1 loop`. */
function KindCounts({ counts }: { counts: ReadonlyMap<IssueKind, number> }) {
  const kinds = KIND_ORDER.filter((kind) => counts.has(kind));
  if (!kinds.length) return <span className="text-ink-mute">none</span>;
  return (
    <span>
      {kinds.map((kind, i) => (
        <span key={kind} data-tone={ISSUE_KINDS[kind].color.tone} title={ISSUE_KINDS[kind].what}>
          {i ? " · " : ""}
          {counts.get(kind)} {ISSUE_KINDS[kind].label}
        </span>
      ))}
    </span>
  );
}

const countIssues = (issues: readonly Issue[]) => {
  const counts = new Map<IssueKind, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  return counts;
};

type GroupRow = DuctSnapshot["groups"][number] & {
  readiness: GroupReadiness;
  cfm: number;
  longestFt: number | null;
};

export function DuctsLedger({
  snapshot,
  ready,
  page,
  setPage,
  empty,
  work,
}: {
  snapshot: DuctSnapshot | null;
  ready: Record<string, GroupReadiness>;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
  work: { doc: DuctsRouteDocument | null; write: (patch: RouteStatePatch[]) => Promise<unknown> };
}) {
  const hosted = useContext(ChatHosted);
  const issuesByGroup = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of snapshot?.issues ?? [])
      map.set(issue.groupId, [...(map.get(issue.groupId) ?? []), issue]);
    return map;
  }, [snapshot]);
  const tree = useMemo(
    () => (snapshot?.group === page.group && page.group ? groupTree(snapshot, page.group) : null),
    [snapshot, page.group],
  );
  const groups = useMemo<GroupRow[]>(
    () =>
      (snapshot?.groups ?? []).map((g) => {
        return {
          ...g,
          readiness: ready[g.id]!,
          cfm: g.designCfm,
          longestFt:
            g.id === page.group && tree?.longest.length
              ? tree.dist.get(tree.longest.at(-1)!)!
              : null,
        };
      }),
    [snapshot, tree, ready, page.group],
  );
  const runs = useMemo(() => (tree ? runsOf(tree) : []), [tree]);
  const selected = page.selected ? Number(page.selected) : null;
  const active =
    runs.find((r) => r.terminal === selected) ??
    runs.find((r) => selected != null && r.path.includes(selected)) ??
    null;
  const readiness = page.group ? ready[page.group] : undefined;
  const open = new Set([...(readiness?.walk ?? []), ...(readiness?.budget ?? [])]);
  // Taxonomy order (walk blockers, budget blockers, advisory). Never by answer: a row must not
  // move under the hand that just answered it.
  const issues = [...(page.group ? (issuesByGroup.get(page.group) ?? []) : [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id),
  );

  const groupColumns: Column<GroupRow>[] = [
    {
      key: "id",
      label: "group",
      width: "w-24",
      cell: (g) => g.id,
      sort: (g) => g.id,
      search: (g) => g.id,
    },
    {
      key: "ready",
      label: "ready",
      width: "w-24",
      title: "Derived from the snapshot's issues and your staged assumptions",
      verdict: (g) => READY[g.readiness.level],
    },
    {
      key: "class",
      label: "classification",
      width: "w-28",
      cell: (g) => g.classifications.join(", "),
      facet: (g) => g.classifications.join(", "),
    },
    {
      key: "terminals",
      label: "terminals",
      right: true,
      width: "w-20",
      cell: (g) => g.terminalCount,
      sort: (g) => g.terminalCount,
    },
    {
      key: "cfm",
      label: "design cfm",
      right: true,
      width: "w-24",
      title: "The terminals' stated design flow, summed: the demand the root must deliver",
      cell: (g) => num(g.cfm),
      sort: (g) => g.cfm,
    },
    {
      key: "longest",
      label: "longest ft",
      right: true,
      width: "w-24",
      title:
        "Developed straight length of the longest run from the root; the critical-path stand-in",
      cell: (g) => num(g.longestFt, 1),
      sort: (g) => g.longestFt ?? -1,
    },
    {
      key: "issues",
      label: "issues by kind",
      cell: (g) => <KindCounts counts={new Map(g.issueCounts.map((c) => [c.kind, c.count]))} />,
      sort: (g) => g.issueCounts.reduce((n, c) => n + c.count, 0),
    },
  ];

  const runColumns: Column<Run>[] = [
    {
      key: "terminal",
      label: "run to terminal",
      width: "w-32",
      cell: (r) =>
        `${r.terminal}${snapshot?.pressure ? (critical?.terminalId === r.terminal ? " · critical" : "") : r.longest ? " · longest" : ""}`,
      search: (r) => String(r.terminal),
    },
    {
      key: "developed",
      label: "developed ft",
      right: true,
      width: "w-24",
      title:
        "Straight duct from the root to this terminal. Fitting equivalent lengths are not in it.",
      cell: (r) => num(r.developedFt, 1),
      sort: (r) => r.developedFt,
    },
    {
      key: "fittings",
      label: "fittings by part type",
      cell: (r) =>
        Object.entries(r.fittings)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([kind, n]) => `${n} ${kind}`)
          .join(" · ") + (r.accessories ? ` · ${r.accessories} accessory` : ""),
    },
    {
      key: "cfm",
      label: "terminal cfm",
      right: true,
      width: "w-24",
      cell: (r) => num(r.terminalCfm),
      sort: (r) => r.terminalCfm ?? -1,
    },
    {
      key: "drop",
      label: "Revit drop in-wg",
      right: true,
      width: "w-36",
      title:
        "Revit's reported pressure drop, summed over the path's segments that report one (revit-reported); a test oracle, not a result",
      cell: (r) =>
        r.revitDropInWg == null
          ? `none · 0/${r.revitDropCoverage.of}`
          : `${num(r.revitDropInWg, 3)} · ${r.revitDropCoverage.have}/${r.revitDropCoverage.of} revit-reported`,
      sort: (r) => r.revitDropInWg ?? -1,
    },
    {
      key: "issues",
      label: "issues on the run",
      cell: (r) => <KindCounts counts={countIssues(r.issues)} />,
      sort: (r) => r.issues.length,
    },
  ];

  const issueColumns: Column<Issue>[] = [
    {
      key: "kind",
      label: "issue",
      width: "w-36",
      verdict: (i) => issueVerdict(i.kind),
      facet: (i) => ISSUE_KINDS[i.kind].label,
    },
    {
      key: "element",
      label: "element",
      width: "w-24",
      cell: (i) => i.elementId ?? "",
      search: (i) => String(i.elementId ?? ""),
    },
    {
      key: "holds",
      label: "holds back",
      width: "w-28",
      title: "What this issue still blocks under the staged assumptions",
      verdict: (i) =>
        ISSUE_KINDS[i.kind].blocks === "none"
          ? { word: "advisory", tone: "mute", note: "blocks nothing" }
          : open.has(i.id)
            ? {
                word: ISSUE_KINDS[i.kind].blocks === "walkable" ? "the walk" : "the budget",
                tone: ISSUE_KINDS[i.kind].color.tone,
                note: ISSUE_KINDS[i.kind].what,
              }
            : { word: "answered", tone: "done", note: "a staged assumption resolves it" },
    },
    {
      key: "assumption",
      label: "assumption",
      width: "w-64",
      title: "Stage an answer into the assumptions Work. Staged only: nothing is written to Revit.",
      cell: (i) => <AssumptionCell issue={i} work={work} />,
    },
    { key: "note", label: "note", cell: (i) => i.note, search: (i) => i.note },
  ];

  const none = empty ? (
    <EmptyState story="scope" exit={empty.exit}>
      {empty.says}
    </EmptyState>
  ) : undefined;
  const pick = none ?? (
    <EmptyState story="scope" exit="choose a group in the groups table or the sentence">
      no group chosen
    </EmptyState>
  );
  const critical = snapshot ? groupPressure(snapshot, page.group)?.criticalPath : null;

  return (
    <PaneSplit
      axis="vertical"
      grow
      resize={{
        target: "end",
        defaultSize: 360,
        minSize: 160,
        persist: "pe.ducts.ledgerIssuesHeight",
      }}
      start={
        <PaneSplit
          axis={hosted ? "vertical" : "horizontal"}
          grow
          resize={{
            target: "end",
            defaultSize: hosted ? 240 : 760,
            minSize: hosted ? 120 : 360,
            minOtherSize: 120,
            persist: hosted ? undefined : "pe.ducts.ledgerRunsWidth",
          }}
          start={
            <Pane
              kind="content"
              title="groups"
              meta={snapshot ? `${groups.length}` : undefined}
              scroll="clip"
              flush
            >
              <Table
                label="duct groups ledger"
                rows={groups}
                columns={groupColumns}
                rowKey={(g) => g.id}
                activeKey={page.group || null}
                onRowClick={(g) =>
                  setPage({ group: page.group === g.id ? "" : g.id, selected: "", issue: "" })
                }
                empty={none}
              />
            </Pane>
          }
          end={
            <Pane
              kind="content"
              title="runs"
              meta={tree ? `${runs.length}` : undefined}
              scroll="clip"
              flush
            >
              {tree && snapshot ? (
                <div className="px-2 py-1 t-small">
                  <PressureBudget snapshot={snapshot} group={page.group} />
                </div>
              ) : null}
              <Table
                label="duct runs"
                rows={runs}
                columns={runColumns}
                rowKey={(r) => String(r.terminal)}
                activeKey={active ? String(active.terminal) : null}
                onRowClick={(r) => setPage({ selected: String(r.terminal), issue: "" })}
                empty={pick}
              />
            </Pane>
          }
        />
      }
      end={
        <PaneSplit
          axis={hosted ? "vertical" : "horizontal"}
          grow
          resize={{
            target: "end",
            defaultSize: hosted ? 120 : 360,
            minSize: hosted ? 80 : 200,
            minOtherSize: 160,
            persist: hosted ? undefined : "pe.ducts.ledgerMapWidth",
          }}
          start={
            <Pane
              kind="content"
              title="issues"
              meta={page.group ? `${issues.length} · ${readiness?.level ?? ""}` : undefined}
              scroll="clip"
              flush
            >
              <IssueLegend />
              <Table
                label="duct issues ledger"
                rows={issues}
                columns={issueColumns}
                rowKey={(i) => i.id}
                activeKey={page.issue || null}
                onRowClick={(i) =>
                  setPage({ selected: i.elementId == null ? "" : String(i.elementId), issue: i.id })
                }
                empty={pick}
              />
            </Pane>
          }
          end={
            <Pane
              kind="content"
              title="assumptions and pressure"
              meta={active ? `run to ${active.terminal}` : undefined}
            >
              {tree && snapshot ? (
                <div className="flex flex-col gap-3">
                  <NumericAssumptions snapshot={snapshot} group={page.group} work={work} />
                  {snapshot.pressure ? (
                    <PressureIssues
                      pressure={snapshot.pressure}
                      group={page.group}
                      select={(id) => setPage({ selected: String(id), issue: "" })}
                    />
                  ) : null}
                  <MiniMap tree={tree} run={active} selected={selected} />
                </div>
              ) : (
                pick
              )}
            </Pane>
          }
        />
      }
    />
  );
}

/** The group's plan footprint (Revit xy, north up), the active run dark, the selection filled. */
function MiniMap({
  tree,
  run,
  selected,
}: {
  tree: GroupTree;
  run: Run | null;
  selected: number | null;
}) {
  const onRun = new Set(run?.path ?? []);
  const lines = [...tree.parts.values()].flatMap((p) =>
    p.segment ? [{ id: p.id, points: p.segment.polyline.map(([x, y]) => [x!, -y!] as const) }] : [],
  );
  const dots = [...tree.parts.values()].flatMap((p) =>
    p.node?.kind === "terminal" ? [{ id: p.id, x: p.node.point[0]!, y: -p.node.point[1]! }] : [],
  );
  const xs = [...lines.flatMap((l) => l.points.map((p) => p[0])), ...dots.map((d) => d.x)];
  const ys = [...lines.flatMap((l) => l.points.map((p) => p[1])), ...dots.map((d) => d.y)];
  if (!xs.length)
    return (
      <EmptyState story="scope" exit="choose a group with duct">
        no geometry in this group
      </EmptyState>
    );
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.05;
  return (
    <svg
      role="img"
      aria-label={`plan of ${tree.groupId}`}
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
      className="size-full"
    >
      {lines.map((line) => {
        const d = line.points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
        return (
          <g key={line.id}>
            {line.id === selected ? (
              <path
                d={d}
                fill="none"
                stroke={tokenRef("select")}
                strokeWidth={9}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <path
              d={d}
              fill="none"
              stroke={tokenRef(onRun.has(line.id) ? "ink" : "ink-mute")}
              strokeWidth={onRun.has(line.id) ? 2.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {dots.map((dot) => (
        <circle
          key={dot.id}
          cx={dot.x}
          cy={dot.y}
          r={pad / 3}
          fill={tokenRef(onRun.has(dot.id) || dot.id === selected ? "ink" : "ink-mute")}
        />
      ))}
    </svg>
  );
}
