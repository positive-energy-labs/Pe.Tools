/**
 * T2 `ledger`: the engineer's worksheet, table first. Groups with their readiness; the chosen
 * group's runs from the root out to each terminal, Manual D style; its issues with the one
 * assumption editor this route has; and a plan-xy mini-map of the group with the active run
 * drawn dark. Assumptions stage into the `assumptions` Work only (Pea may propose the same
 * keys); nothing is written to Revit, and readiness re-derives from what is staged.
 */
import { useMemo } from "react";
import {
  transitionPatches,
  type DuctAssumption,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import { Switcher } from "#/components/lang/switcher";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { tokenRef } from "#/lib/token";
import { ISSUE_KINDS, IssueLegend, issueVerdict, type Blocks, type IssueKind } from "./issues";
import type { DuctsPage } from "./manifest";
import type { DuctSnapshot, GroupReadiness } from "./readiness";
import { READY } from "./tables";
import { groupTree, runsOf, terminalCfm, type GroupTree, type Run } from "./topology";

type Issue = DuctSnapshot["issues"][number];
type Verdict = Extract<DuctAssumption, { kind: "verdict" }>["verdict"];
type Choice = Verdict | "unset";

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
function KindCounts({ issues }: { issues: readonly Issue[] }) {
  const counts = new Map<IssueKind, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
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

/** The verdicts an issue kind can take: open ends all three; the rest that `ignore` resolves. */
const CHOICES: Partial<Record<IssueKind, readonly Verdict[]>> = {
  "open-end": ["capped", "connect", "ignore"],
  "no-terminal-flow": ["ignore"],
  "default-flex-roughness": ["ignore"],
};
const CHOICE_TITLE: Record<Choice, string> = {
  capped: "Capped: this end carries no flow. Resolves the open end.",
  connect: "Connect: the model must be fixed in Revit. Does not resolve the open end.",
  ignore: "Ignore: leave this out of the walk. Resolves it.",
  unset: "No staged answer.",
};

/** The patches one verdict choice makes on an issue's cell: stage it, or unstage for `unset`. */
export const verdictPatches = (
  doc: DuctsRouteDocument | null,
  issueId: string,
  choice: Choice,
): RouteStatePatch[] =>
  transitionPatches(
    ["assumptions"],
    issueId,
    doc?.assumptions[issueId] ?? {},
    choice === "unset"
      ? { kind: "unstage" }
      : { kind: "stage", rung: { value: { kind: "verdict", verdict: choice } } },
  );

const verdictAt = (value: DuctAssumption | undefined) =>
  value?.kind === "verdict" ? value.verdict : null;

type GroupRow = DuctSnapshot["groups"][number] & {
  readiness: GroupReadiness;
  cfm: number;
  longestFt: number | null;
  own: Issue[];
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
  const issuesByGroup = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of snapshot?.issues ?? [])
      map.set(issue.groupId, [...(map.get(issue.groupId) ?? []), issue]);
    return map;
  }, [snapshot]);
  // Terminal cfm and longest run per group: one tree per group, built once per snapshot.
  const trees = useMemo(() => {
    const map = new Map<string, GroupTree>();
    for (const g of snapshot?.groups ?? []) map.set(g.id, groupTree(snapshot!, g.id));
    return map;
  }, [snapshot]);
  const groups = useMemo<GroupRow[]>(
    () =>
      (snapshot?.groups ?? []).map((g) => {
        const tree = trees.get(g.id)!;
        return {
          ...g,
          readiness: ready[g.id]!,
          cfm: tree.terminals.reduce(
            (sum, t) => sum + (terminalCfm(tree.parts.get(t)!.node) ?? 0),
            0,
          ),
          longestFt: tree.longest.length ? tree.dist.get(tree.longest.at(-1)!)! : null,
          own: issuesByGroup.get(g.id) ?? [],
        };
      }),
    [snapshot, trees, ready, issuesByGroup],
  );
  const tree = page.group ? (trees.get(page.group) ?? null) : null;
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
      cell: (g) => <KindCounts issues={g.own} />,
      sort: (g) => g.own.length,
    },
  ];

  const runColumns: Column<Run>[] = [
    {
      key: "terminal",
      label: "run to terminal",
      width: "w-32",
      cell: (r) => (r.longest ? `${r.terminal} · longest` : String(r.terminal)),
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
      cell: (r) => <KindCounts issues={r.issues} />,
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
  const equipment = snapshot?.nodes.find((n) => n.id === tree?.root?.equipment);
  const esp = equipment?.facts.find((f) => f.key === "externalStatic")?.value;
  const longest = runs.find((r) => r.longest);

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
          axis="horizontal"
          grow
          resize={{
            target: "end",
            defaultSize: 760,
            minSize: 360,
            persist: "pe.ducts.ledgerRunsWidth",
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
              {tree ? (
                <p className="px-2 py-1 t-small text-ink-2">
                  {tree.rootWord}. Manual D: friction rate = available static × 100 / total
                  effective length of the critical run. Available static ={" "}
                  {esp != null ? `${esp} in-wg fan static` : "fan static (not stated)"} minus
                  component drops. Total effective length ={" "}
                  {longest ? `${num(longest.developedFt, 1)} ft straight` : "no run"} plus the
                  fittings' equivalent length, which needs the loss solver, so no friction rate is
                  drawn.
                </p>
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
          axis="horizontal"
          grow
          resize={{
            target: "end",
            defaultSize: 360,
            minSize: 200,
            persist: "pe.ducts.ledgerMapWidth",
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
              title="plan"
              meta={active ? `run to ${active.terminal}` : undefined}
            >
              {tree ? <MiniMap tree={tree} run={active} selected={selected} /> : pick}
            </Pane>
          }
        />
      }
    />
  );
}

/** The staged verdict of one issue, and its editor where a verdict can answer it. */
function AssumptionCell({
  issue,
  work,
}: {
  issue: Issue;
  work: { doc: DuctsRouteDocument | null; write: (patch: RouteStatePatch[]) => Promise<unknown> };
}) {
  const cell = work.doc?.assumptions[issue.id];
  const staged = verdictAt(cell?.staged?.value);
  const proposed = verdictAt(cell?.proposal?.value);
  const choices = CHOICES[issue.kind];
  if (!choices) {
    const info = ISSUE_KINDS[issue.kind];
    return (
      <span className="text-ink-mute">
        {info.blocks === "budgetable"
          ? "needs an override value"
          : info.blocks === "walkable"
            ? "needs a structural answer"
            : ""}
      </span>
    );
  }
  const options = [...choices, "unset" as const].map((value) => ({
    value,
    label: value,
    title: CHOICE_TITLE[value],
  }));
  return (
    <span className="flex items-center gap-1">
      <Switcher<Choice>
        ariaLabel={`assumption for ${issue.id}`}
        options={options}
        value={staged ?? "unset"}
        onChange={(choice) => void work.write(verdictPatches(work.doc, issue.id, choice))}
      />
      {proposed && proposed !== staged ? (
        <span data-tone="pea" title="Pea proposed this; choose it to stage it">
          Pea: {proposed}
        </span>
      ) : null}
    </span>
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
