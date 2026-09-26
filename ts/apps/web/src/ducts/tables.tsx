/**
 * The default /ducts view: master tables of groups, segments and issues, beside the layer list
 * that prints each layer's query and coverage. Views are keyed by `page.view`; this is "".
 */
import { useMemo } from "react";

import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import type { DuctsPage } from "./manifest";
import type { DuctSnapshot, GroupReadiness } from "./readiness";

type Group = DuctSnapshot["groups"][number];
type Segment = DuctSnapshot["segments"][number];
type Issue = DuctSnapshot["issues"][number];
type Layer = DuctSnapshot["layers"][number];
type GroupRow = Group & { readiness: GroupReadiness };
type SegmentRow = Segment & { derivedCfm: number | null };

const num = (value: number | null | undefined, digits = 0) =>
  value == null ? "" : value.toFixed(digits);

const READY = {
  blocked: {
    word: "blocked",
    tone: "alarm",
    note: "a walk from the root cannot reach every terminal",
  },
  walkable: {
    word: "walkable",
    tone: "caution",
    note: "walkable; fan static or component drops unknown",
  },
  budgetable: {
    word: "budgetable",
    tone: "done",
    note: "walkable, and every static and drop is known",
  },
} as const;

const GROUP_COLUMNS: Column<GroupRow>[] = [
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
    cell: (g) => g.classifications.join(", "),
    facet: (g) => g.classifications.join(", "),
    search: (g) => g.classifications.join(" "),
  },
  {
    key: "systems",
    label: "systems",
    cell: (g) => g.systemNames.join(", "),
    search: (g) => g.systemNames.join(" "),
  },
  {
    key: "elements",
    label: "elements",
    right: true,
    width: "w-20",
    cell: (g) => g.elementCount,
    sort: (g) => g.elementCount,
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
    key: "roots",
    label: "roots",
    right: true,
    width: "w-16",
    cell: (g) => g.rootIds.length,
    sort: (g) => g.rootIds.length,
  },
  {
    key: "issues",
    label: "issues",
    right: true,
    width: "w-16",
    cell: (g) => g.issueIds.length,
    sort: (g) => g.issueIds.length,
  },
];

const SEGMENT_COLUMNS: Column<SegmentRow>[] = [
  {
    key: "id",
    label: "element",
    width: "w-24",
    cell: (s) => s.id,
    sort: (s) => s.id,
    search: (s) => String(s.id),
  },
  { key: "kind", label: "kind", width: "w-16", cell: (s) => s.kind, facet: (s) => s.kind },
  { key: "size", label: "size", width: "w-20", cell: (s) => s.size, facet: (s) => s.size },
  {
    key: "length",
    label: "length ft",
    right: true,
    width: "w-20",
    cell: (s) => num(s.lengthFt, 2),
    sort: (s) => s.lengthFt,
  },
  {
    key: "system",
    label: "system",
    cell: (s) => s.systemName ?? "",
    facet: (s) => s.systemName ?? "",
  },
  {
    key: "derived",
    label: "cfm (pass 1)",
    right: true,
    width: "w-24",
    title: "Terminal design flow summed up the tree from the one root; derived",
    cell: (s) => num(s.derivedCfm),
    sort: (s) => s.derivedCfm ?? -1,
  },
  {
    key: "revitFlow",
    label: "cfm (Revit)",
    right: true,
    width: "w-24",
    title: "RBS_DUCT_FLOW_PARAM as Revit reports it",
    cell: (s) => num(s.revit.flowCfm),
    sort: (s) => s.revit.flowCfm ?? -1,
  },
  {
    key: "velocity",
    label: "fpm (Revit)",
    right: true,
    width: "w-24",
    cell: (s) => num(s.revit.velocityFpm),
    sort: (s) => s.revit.velocityFpm ?? -1,
  },
  {
    key: "roughness",
    label: "roughness ft",
    right: true,
    width: "w-28",
    title: "MEPCurveType.Roughness; the word says where it came from",
    cell: (s) => `${s.roughness.valueFt} · ${s.roughness.provenance}`,
    facet: (s) => s.roughness.provenance,
  },
];

const ISSUE_COLUMNS: Column<Issue>[] = [
  { key: "kind", label: "issue", width: "w-40", cell: (i) => i.kind, facet: (i) => i.kind },
  {
    key: "element",
    label: "element",
    width: "w-24",
    cell: (i) => i.elementId ?? "",
    search: (i) => String(i.elementId ?? ""),
  },
  { key: "group", label: "group", width: "w-24", cell: (i) => i.groupId, facet: (i) => i.groupId },
  { key: "note", label: "note", cell: (i) => i.note, search: (i) => i.note },
];

const LAYER_COLUMNS = (on: ReadonlySet<string>): Column<Layer>[] => [
  {
    key: "on",
    label: "drawn",
    width: "w-16",
    verdict: (l) =>
      on.has(l.key)
        ? { word: "on", tone: "ink", note: "this layer is enabled" }
        : { word: "off", tone: "mute", note: "click the row to enable it", dim: true },
  },
  { key: "title", label: "layer", width: "w-48", cell: (l) => l.title, search: (l) => l.title },
  {
    key: "provenance",
    label: "source",
    width: "w-28",
    cell: (l) => l.provenance,
    facet: (l) => l.provenance,
  },
  {
    key: "coverage",
    label: "coverage",
    right: true,
    width: "w-28",
    cell: (l) => `${l.coverage.have} / ${l.coverage.of}`,
    sort: (l) => (l.coverage.of ? l.coverage.have / l.coverage.of : 0),
  },
  {
    key: "query",
    label: "query",
    cell: (l) => <span className="font-mono">{l.query}</span>,
    search: (l) => l.query,
  },
];

export function DuctsTables({
  snapshot,
  ready,
  page,
  setPage,
  empty,
}: {
  snapshot: DuctSnapshot | null;
  ready: Record<string, GroupReadiness>;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
}) {
  const groups = useMemo(
    () => (snapshot?.groups ?? []).map((g) => ({ ...g, readiness: ready[g.id]! })),
    [snapshot, ready],
  );
  const flows = useMemo(
    () => new Map((snapshot?.flows ?? []).map((f) => [f.segmentId, f.cfm])),
    [snapshot],
  );
  const inScope = <T extends { groupId?: string | null; levelId?: number | null }>(
    rows: readonly T[],
  ) =>
    rows.filter(
      (row) =>
        (!page.group || row.groupId === page.group) &&
        (!page.level || String(row.levelId ?? "") === page.level),
    );
  const segments = useMemo(
    () =>
      inScope(snapshot?.segments ?? []).map((s) => ({ ...s, derivedCfm: flows.get(s.id) ?? null })),
    [snapshot, flows, page.group, page.level], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const issues = useMemo(
    () => (snapshot?.issues ?? []).filter((i) => !page.group || i.groupId === page.group),
    [snapshot, page.group],
  );
  const on = useMemo(() => new Set(page.layers), [page.layers]);
  const toggle = (key: string) =>
    setPage({ layers: on.has(key) ? page.layers.filter((k) => k !== key) : [...page.layers, key] });
  const none = empty ? (
    <EmptyState story="scope" exit={empty.exit}>
      {empty.says}
    </EmptyState>
  ) : undefined;

  return (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{ target: "end", defaultSize: 640, minSize: 360, persist: "pe.ducts.layersWidth" }}
      start={
        <PaneSplit
          axis="vertical"
          grow
          resize={{
            target: "end",
            defaultSize: 320,
            minSize: 160,
            persist: "pe.ducts.issuesHeight",
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
                label="duct groups"
                rows={groups}
                columns={GROUP_COLUMNS}
                rowKey={(g) => g.id}
                activeKey={page.group || null}
                onRowClick={(g) =>
                  setPage({ group: page.group === g.id ? "" : g.id, selected: "" })
                }
                empty={none}
              />
            </Pane>
          }
          end={
            <PaneSplit
              axis="horizontal"
              grow
              resize={{
                target: "end",
                defaultSize: 420,
                minSize: 240,
                persist: "pe.ducts.issuesWidth",
              }}
              start={
                <Pane
                  kind="content"
                  title="segments"
                  meta={snapshot ? `${segments.length}` : undefined}
                  scroll="clip"
                  flush
                >
                  <Table
                    label="duct segments"
                    rows={segments}
                    columns={SEGMENT_COLUMNS}
                    rowKey={(s) => String(s.id)}
                    activeKey={page.selected || null}
                    onRowClick={(s) => setPage({ selected: String(s.id) })}
                    empty={none}
                  />
                </Pane>
              }
              end={
                <Pane
                  kind="content"
                  title="issues"
                  meta={snapshot ? `${issues.length}` : undefined}
                  scroll="clip"
                  flush
                >
                  <Table
                    label="duct issues"
                    rows={issues}
                    columns={ISSUE_COLUMNS}
                    rowKey={(i) => i.id}
                    activeKey={page.selected || null}
                    onRowClick={(i) =>
                      setPage({ selected: i.elementId == null ? "" : String(i.elementId) })
                    }
                    empty={none}
                  />
                </Pane>
              }
            />
          }
        />
      }
      end={
        <Pane
          kind="content"
          title="layers"
          meta={snapshot ? `${snapshot.layers.length}` : undefined}
          scroll="clip"
          flush
        >
          <Table
            label="duct layers"
            rows={snapshot?.layers ?? []}
            columns={LAYER_COLUMNS(on)}
            rowKey={(l) => l.key}
            onRowClick={(l) => toggle(l.key)}
            empty={none}
          />
        </Pane>
      }
    />
  );
}
