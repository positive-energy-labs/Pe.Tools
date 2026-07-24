import type { ReactNode } from "react";
import {
  type CatHue,
  Chip,
  DataTable,
  EmptyState,
  KVGrid,
  MonoNote,
  OpSection,
  Provenance,
  TreeView,
  type TreeNode,
} from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";

/**
 * Curated readonly views for the revit.catalog.* ops — Revit-familiar shapes
 * (Project Browser trees, schedule grids, the Home screen card wall) in the PE
 * design language. Testimony only: no mutation affordances.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

const HUE_CYCLE: CatHue[] = ["blue", "green", "slate", "lichen", "clay", "kiln"];

/** Stable categorical hue for an arbitrary name (categories, sections). */
function hueFor(name: string): CatHue {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return HUE_CYCLE[Math.abs(hash) % HUE_CYCLE.length] ?? "slate";
}

/** Truncation/limit line from the shared RevitDataResultPage shape, if present. */
function pageNote(data: Record<string, unknown>): string | undefined {
  const page = asRecord(data.page);
  if (!page) return undefined;
  const total = asNumber(page.totalCount);
  const returned = asNumber(page.returnedCount);
  if (total === undefined || returned === undefined) return undefined;
  const truncated = page.isTruncated === true;
  return truncated
    ? `${returned} of ${total} returned — truncated by budget`
    : `${returned} of ${total} returned`;
}

/** Shared RevitDataIssue[] rendered as a quiet mono block, warnings/errors tinted. */
function IssuesNote({ data }: { data: Record<string, unknown> }) {
  const issues = asRecords(data.issues);
  if (issues.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {issues.map((issue, i) => {
        const severity = asString(issue.severity) ?? "Info";
        const hue: CatHue | undefined =
          severity === "Error" ? "kiln" : severity === "Warning" ? "clay" : undefined;
        return (
          <div key={`${asString(issue.code) ?? "issue"}-${i}`}>
            <MonoNote hue={hue}>
              {severity.toLowerCase()} {asString(issue.code)}: {asString(issue.message)}
            </MonoNote>
          </div>
        );
      })}
    </div>
  );
}

/** Chip row that caps display and says how many were left out. */
function ChipRow({
  values,
  hue = "slate",
  max = 4,
}: {
  values: string[];
  hue?: CatHue | ((value: string) => CatHue);
  max?: number;
}) {
  if (values.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = values.slice(0, max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((value) => (
        <Chip key={value} hue={typeof hue === "function" ? hue(value) : hue} title={value}>
          {value}
        </Chip>
      ))}
      {values.length > max && <MonoNote>+{values.length - max}</MonoNote>}
    </span>
  );
}

/** Insert a path (segment list) into a mutable tree, returning the leaf node. */
function insertPath(
  roots: TreeNode[],
  index: Map<string, TreeNode>,
  keyPrefix: string,
  segments: string[],
): TreeNode | undefined {
  let siblings = roots;
  let key = keyPrefix;
  let node: TreeNode | undefined;
  for (const segment of segments) {
    key = `${key}/${segment}`;
    let existing = index.get(key);
    if (!existing) {
      existing = {
        id: key,
        label: <span className="font-medium">{segment}</span>,
        children: [],
      };
      index.set(key, existing);
      siblings.push(existing);
    }
    node = existing;
    siblings = existing.children ?? (existing.children = []);
  }
  return node;
}

/* ── revit.catalog.project-index — the Project Browser homage ─────────────── */

type IndexSection = {
  key: string;
  label: string;
  count: number | undefined;
  entries: Record<string, unknown>[];
  toNode: (entry: Record<string, unknown>, i: number) => TreeNode;
};

/** Nest an entry under its browserPaths folders where present. */
function nestByBrowserPaths(section: IndexSection): TreeNode[] {
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  section.entries.forEach((entry, i) => {
    const leaf = section.toNode(entry, i);
    const paths = asRecords(entry.browserPaths);
    const first = paths[0];
    const segments = first
      ? asRecords(first.segments)
          .map((s) => asString(s.folderName))
          .filter((s): s is string => !!s)
      : [];
    if (segments.length > 0) {
      const folder = insertPath(roots, index, section.key, segments);
      (folder?.children ?? roots).push(leaf);
    } else {
      roots.push(leaf);
    }
  });
  return roots;
}

function ProjectIndexView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const summary = asRecord(record.summary) ?? {};

  const handleLabel = (entry: Record<string, unknown>): string =>
    asString(entry.name) ??
    asString(entry.categoryName) ??
    asString(entry.familyName) ??
    asString(asRecord(entry.handle)?.label) ??
    "∅";

  const sections: IndexSection[] = [
    {
      key: "levels",
      label: "Levels",
      count: asNumber(summary.levelCount),
      entries: asRecords(record.levels),
      toNode: (e, i) => ({
        id: `levels/${i}`,
        label: handleLabel(e),
        meta: `elev ${asNumber(e.elevation)?.toFixed(2) ?? "?"} · ${asNumber(e.viewCount) ?? 0} views`,
      }),
    },
    {
      key: "views",
      label: "Views",
      count: asNumber(summary.viewCount),
      entries: asRecords(record.views),
      toNode: (e, i) => ({
        id: `views/${i}`,
        label: handleLabel(e),
        meta: `${asString(e.viewType) ?? "view"}${e.isPlacedOnSheet === true ? " · on sheet" : ""}`,
      }),
    },
    {
      key: "sheets",
      label: "Sheets",
      count: asNumber(summary.sheetCount),
      entries: asRecords(record.sheets),
      toNode: (e, i) => ({
        id: `sheets/${i}`,
        label: `${asString(e.sheetNumber) ?? "?"} — ${asString(e.sheetName) ?? "∅"}`,
        meta: `${asNumber(e.placedViewCount) ?? 0} views · ${asNumber(e.placedScheduleCount) ?? 0} schedules`,
      }),
    },
    {
      key: "schedules",
      label: "Schedules",
      count: asNumber(summary.scheduleCount),
      entries: asRecords(record.schedules),
      toNode: (e, i) => ({
        id: `schedules/${i}`,
        label: handleLabel(e),
        meta: `${asNumber(e.visibleBodyRowCount) ?? 0} rows${e.isPlacedOnSheet === true ? " · on sheet" : ""}`,
      }),
    },
    {
      key: "categories",
      label: "Categories",
      count: asNumber(summary.categoryCount),
      entries: asRecords(record.categories),
      toNode: (e, i) => ({
        id: `categories/${i}`,
        label: handleLabel(e),
        meta: `${asNumber(e.familyCount) ?? 0} families · ${asNumber(e.placedInstanceCount) ?? 0} placed`,
      }),
    },
    {
      key: "families",
      label: "Families",
      count: asNumber(summary.familyCount),
      entries: asRecords(record.families),
      toNode: (e, i) => ({
        id: `families/${i}`,
        label: handleLabel(e),
        meta: `${asNumber(e.typeCount) ?? 0} types · ${asNumber(e.placedInstanceCount) ?? 0} placed`,
      }),
    },
  ];

  const nodes: TreeNode[] = sections
    .filter((s) => s.entries.length > 0 || (s.count ?? 0) > 0)
    .map((s) => ({
      id: s.key,
      label: s.label,
      meta: s.count !== undefined ? `${s.entries.length} of ${s.count}` : `${s.entries.length}`,
      defaultOpen: false,
      children: nestByBrowserPaths(s),
    }));

  if (nodes.length === 0) return <EmptyState note="project index returned no sections" />;
  return (
    <OpSection label="Project Index">
      <TreeView nodes={nodes} dense />
      <Provenance>
        {summary.truncated === true ? "index truncated by budget · " : ""}
        {pageNote(record) ?? "counts are index-time observations, not live proof"}
      </Provenance>
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.project-browser — the literal browser organization ─────── */

function ProjectBrowserView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const organizations = asRecords(record.organizations);
  const items = asRecords(record.items);

  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();

  for (const org of organizations) {
    const section = asString(org.section) ?? "Views";
    const sectionNode: TreeNode = {
      id: `org/${section}`,
      label: section,
      meta: `${asNumber(org.folderCount) ?? 0} folders · ${asNumber(org.indexedElementCount) ?? 0} indexed`,
      defaultOpen: true,
      children: [],
    };
    index.set(`org/${section}`, sectionNode);
    roots.push(sectionNode);
    for (const folder of asRecords(org.folders)) {
      const pathLabel = asString(folder.pathLabel);
      if (!pathLabel) continue;
      const folderNode: TreeNode = {
        id: `org/${section}/folder/${pathLabel}`,
        label: <span className="font-medium">{pathLabel}</span>,
        meta: `${asNumber(folder.elementCount) ?? 0}`,
        children: asRecords(folder.sampleHandles).map((h, i) => ({
          id: `org/${section}/folder/${pathLabel}/sample/${i}`,
          label: asString(h.label) ?? "∅",
          meta: asNumber(h.elementId) !== undefined ? `id ${asNumber(h.elementId)}` : undefined,
        })),
      };
      sectionNode.children?.push(folderNode);
    }
  }

  for (const item of items) {
    const path = asRecord(item.browserPath);
    const handle = asRecord(item.handle);
    const section = asString(path?.section) ?? "Views";
    const sectionKey = `org/${section}`;
    if (!index.has(sectionKey)) {
      const sectionNode: TreeNode = {
        id: sectionKey,
        label: section,
        defaultOpen: true,
        children: [],
      };
      index.set(sectionKey, sectionNode);
      roots.push(sectionNode);
    }
    const sectionNode = index.get(sectionKey);
    const segments = path
      ? asRecords(path.segments)
          .map((s) => asString(s.folderName))
          .filter((s): s is string => !!s)
      : [];
    const leaf: TreeNode = {
      id: `${sectionKey}/item/${asString(handle?.uniqueId) ?? asString(handle?.label) ?? String(items.indexOf(item))}`,
      label: asString(handle?.label) ?? "∅",
      meta:
        asNumber(handle?.elementId) !== undefined ? `id ${asNumber(handle?.elementId)}` : undefined,
    };
    if (segments.length > 0 && sectionNode) {
      const folder = insertPath(
        sectionNode.children ?? (sectionNode.children = []),
        index,
        sectionKey,
        segments,
      );
      (folder?.children ?? sectionNode.children)?.push(leaf);
    } else {
      sectionNode?.children?.push(leaf);
    }
  }

  if (roots.length === 0) return <EmptyState note="no browser organization returned" />;
  return (
    <OpSection
      label="Project Browser"
      aside={
        <span title={asString(record.browserSnapshotId)}>
          <MonoNote>snapshot ·{(asString(record.browserSnapshotId) ?? "∅").slice(-8)}</MonoNote>
        </span>
      }
    >
      <TreeView nodes={roots} dense />
      <Provenance>
        view={asString(record.view) ?? "?"} · folder counts are indexed at snapshot time
        {pageNote(record) ? ` · ${pageNote(record)}` : ""}
      </Provenance>
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.schedules — the schedule grid about schedules ──────────── */

function SchedulesView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const entries = asRecords(record.entries);
  const summary = asRecord(record.summary);

  const scopeChips = (entry: Record<string, unknown>): ReactNode => {
    const chips: ReactNode[] = [];
    if (entry.isTemplate === true)
      chips.push(
        <Chip key="tpl" hue="slate">
          template
        </Chip>,
      );
    if (entry.isItemized === true)
      chips.push(
        <Chip key="item" hue="lichen">
          itemized
        </Chip>,
      );
    if (entry.filterBySheet === true)
      chips.push(
        <Chip key="fbs" hue="clay">
          filter-by-sheet
        </Chip>,
      );
    if (asRecords(entry.filters).length > 0)
      chips.push(
        <Chip key="filters" hue="blue">
          {asRecords(entry.filters).length} filters
        </Chip>,
      );
    return chips.length > 0 ? (
      <span className="inline-flex flex-wrap gap-1">{chips}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  };

  return (
    <OpSection label="Schedule Catalog">
      <DataTable
        title="Schedules"
        rows={entries}
        rowKey={(row, i) => asString(row.scheduleUniqueId) ?? `${i}`}
        columns={[
          { key: "name", header: "Schedule", cell: (row) => asString(row.name) ?? "∅" },
          {
            key: "category",
            header: "Category",
            cell: (row) => {
              const category = asString(row.categoryName);
              return category ? (
                <Chip hue={hueFor(category)}>{category}</Chip>
              ) : (
                <span className="text-muted-foreground">—</span>
              );
            },
          },
          {
            key: "sheets",
            header: "Placed On",
            cell: (row) => (
              <ChipRow
                hue="blue"
                values={asRecords(row.sheetPlacements)
                  .map((p) => asString(p.sheetNumber))
                  .filter((s): s is string => !!s)}
              />
            ),
          },
          {
            key: "fields",
            header: "Fields",
            numeric: true,
            cell: (row) => asRecords(row.parameterUsages).length || "—",
          },
          {
            key: "rows",
            header: "Rows",
            numeric: true,
            cell: (row) => asNumber(row.visibleBodyRowCount) ?? "—",
          },
          { key: "scope", header: "Scope", cell: scopeChips },
        ]}
        footer={
          <Provenance>
            {entries.length} schedules listed
            {summary ? ` · ${asNumber(summary.totalSchedules) ?? "?"} total in document` : ""}
            {pageNote(record) ? ` · ${pageNote(record)}` : ""}
            {" · field counts reflect requested projection, not schedule truth"}
          </Provenance>
        }
      />
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.loaded-families — category → family → types ────────────── */

function LoadedFamiliesView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const families = asRecords(record.families);
  const summary = asRecord(record.summary) ?? {};

  const byCategory = new Map<string, Record<string, unknown>[]>();
  for (const family of families) {
    const category = asString(family.categoryName) ?? "(no category)";
    const bucket = byCategory.get(category) ?? [];
    bucket.push(family);
    byCategory.set(category, bucket);
  }

  const nodes: TreeNode[] = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, categoryFamilies]) => ({
      id: `cat/${category}`,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Chip hue={hueFor(category)}>{category}</Chip>
        </span>
      ),
      meta: `${categoryFamilies.length} families`,
      defaultOpen: byCategory.size <= 3,
      children: categoryFamilies.map((family) => ({
        id: `cat/${category}/${asString(family.familyUniqueId) ?? asString(family.familyName) ?? "?"}`,
        label: asString(family.familyName) ?? "∅",
        meta: `${asNumber(family.typeCount) ?? 0} types · ${asNumber(family.placedInstanceCount) ?? 0} placed`,
        children: asRecords(family.types).map((type, i) => ({
          id: `cat/${category}/${asString(family.familyUniqueId) ?? "?"}/type/${i}`,
          label: asString(type.typeName) ?? "∅",
        })),
      })),
    }));

  if (nodes.length === 0) return <EmptyState note="no loaded families in scope" />;
  return (
    <OpSection
      label="Loaded Families"
      aside={
        <>
          <MonoNote>{asNumber(summary.totalFamilies) ?? families.length} families</MonoNote>
          <MonoNote>{asNumber(summary.totalTypes) ?? "?"} types</MonoNote>
          <MonoNote>{asNumber(summary.totalPlacedInstances) ?? "?"} placed</MonoNote>
        </>
      }
    >
      <TreeView nodes={nodes} dense />
      <Provenance>
        {asNumber(summary.placedFamilies) ?? "?"} placed /{" "}
        {asNumber(summary.unplacedFamilies) ?? "?"} unplaced
        {summary.truncated === true ? " · truncated by budget" : ""}
        {pageNote(record) ? ` · ${pageNote(record)}` : ""}
      </Provenance>
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.parameter-bindings — Project Parameters dialog ─────────── */

function ParameterBindingsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const entries = asRecords(record.entries);
  const summary = asRecord(record.summary) ?? {};

  return (
    <OpSection label="Project Parameter Bindings">
      <DataTable
        title="Project Parameters"
        rows={entries}
        rowKey={(row, i) => asString(asRecord(asRecord(row.definition)?.identity)?.key) ?? `${i}`}
        columns={[
          {
            key: "name",
            header: "Parameter",
            cell: (row) => asString(asRecord(asRecord(row.definition)?.identity)?.name) ?? "∅",
          },
          {
            key: "kind",
            header: "Binding",
            cell: (row) => {
              const kind = asString(row.bindingKind);
              if (!kind) return <span className="text-muted-foreground">—</span>;
              return <Chip hue={kind === "Instance" ? "slate" : "kiln"}>{kind}</Chip>;
            },
          },
          {
            key: "categories",
            header: "Categories",
            cell: (row) => (
              <ChipRow
                values={asArray(row.categoryNames).flatMap((v) =>
                  typeof v === "string" ? [v] : [],
                )}
                hue={hueFor}
              />
            ),
          },
          {
            key: "group",
            header: "Group",
            cell: (row) => asString(asRecord(row.definition)?.groupTypeLabel) ?? "—",
          },
          {
            key: "dataType",
            header: "Data Type",
            cell: (row) => asString(asRecord(row.definition)?.dataTypeLabel) ?? "—",
          },
        ]}
        footer={
          <Provenance>
            {asNumber(summary.totalBindings) ?? entries.length} bindings ·{" "}
            {asNumber(summary.instanceBindings) ?? "?"} instance /{" "}
            {asNumber(summary.typeBindings) ?? "?"} type
            {summary.truncated === true ? " · truncated by budget" : ""}
            {pageNote(record) ? ` · ${pageNote(record)}` : ""}
          </Provenance>
        }
      />
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.parameter-evidence — the evidence ledger ───────────────── */

const EVIDENCE_HUES: Record<string, CatHue> = {
  ProjectBinding: "blue",
  ScheduleField: "green",
  ScheduleFilter: "lichen",
  ScopedElement: "clay",
};

function ParameterEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const candidates = asRecords(record.candidates);
  const collectedAt = asString(record.evidenceCollectedAtUtc);

  return (
    <OpSection
      label="Parameter Evidence"
      aside={record.primitiveCacheHit === true ? <MonoNote>cache hit</MonoNote> : undefined}
    >
      <DataTable
        title="Evidence Ledger"
        rows={candidates}
        rowKey={(row, i) => asString(asRecord(row.identity)?.key) ?? `${i}`}
        columns={[
          {
            key: "parameter",
            header: "Parameter",
            cell: (row) => asString(asRecord(row.identity)?.name) ?? "∅",
          },
          {
            key: "score",
            header: "Score",
            numeric: true,
            cell: (row) => asNumber(row.score)?.toFixed(2) ?? "—",
          },
          {
            key: "sources",
            header: "Evidence Sources",
            cell: (row) => {
              const counts = asRecords(row.evidenceCounts);
              if (counts.length === 0) return <span className="text-muted-foreground">—</span>;
              return (
                <span className="inline-flex flex-wrap gap-1">
                  {counts.map((count, i) => {
                    const source = asString(count.source) ?? "?";
                    return (
                      <Chip
                        key={`${source}-${asString(count.scope) ?? i}`}
                        hue={EVIDENCE_HUES[source] ?? "slate"}
                        title={`${source} · scope ${asString(count.scope) ?? "?"} · ${asString(count.strength) ?? "?"}`}
                      >
                        {source} {asNumber(count.count) ?? "?"}
                      </Chip>
                    );
                  })}
                </span>
              );
            },
          },
          {
            key: "total",
            header: "Total",
            numeric: true,
            cell: (row) =>
              asRecords(row.evidenceCounts).reduce((acc, c) => acc + (asNumber(c.count) ?? 0), 0),
          },
          {
            key: "reasons",
            header: "Reasons",
            cell: (row) => {
              const reasons = asArray(row.reasons).flatMap((v) =>
                typeof v === "string" ? [v] : [],
              );
              return reasons.length > 0 ? (
                <span title={reasons.join("\n")}>{reasons[0]}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              );
            },
          },
        ]}
        footer={
          <Provenance>
            {collectedAt ? `evidence collected ${collectedAt}` : "collection time not reported"}
            {pageNote(record) ? ` · ${pageNote(record)}` : ""}
            {" · counts are observations at collection time, not live proof"}
          </Provenance>
        }
      />
      <IssuesNote data={record} />
    </OpSection>
  );
}

/* ── revit.catalog.concept-evidence — ranked inferred candidates ──────────── */

const CONFIDENCE_HUES: Record<string, CatHue> = {
  Low: "kiln",
  Medium: "clay",
  High: "green",
};

function ConceptEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const concepts = asRecords(record.concepts);
  if (concepts.length === 0) return <EmptyState note="no concepts inferred" />;

  return (
    <div className="space-y-4">
      {concepts.map((concept, ci) => {
        const conceptName = asString(concept.concept) ?? `concept ${ci + 1}`;
        const candidates = asRecords(concept.candidates);
        const notes = asArray(concept.evidenceNotes).flatMap((v) =>
          typeof v === "string" ? [v] : [],
        );
        return (
          <OpSection
            key={conceptName}
            label={conceptName}
            aside={<MonoNote>{candidates.length} candidates</MonoNote>}
          >
            <div style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}>
              {candidates.map((candidate, i) => {
                const identity = asRecord(candidate.identity);
                const confidence = asString(candidate.confidence);
                const facts = asRecord(candidate.facts) ?? {};
                const reasons = asArray(candidate.reasons).flatMap((v) =>
                  typeof v === "string" ? [v] : [],
                );
                return (
                  <div
                    key={asString(identity?.key) ?? `${i}`}
                    className="flex min-w-0 items-baseline gap-2 px-2 py-1.5 hover:bg-muted/40"
                    style={i > 0 ? { borderTop: "0.5px solid var(--line-soft)" } : undefined}
                  >
                    <span className="tele w-6 shrink-0 text-right text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="text-xs font-medium">
                          {asString(identity?.name) ?? "∅"}
                        </span>
                        {confidence && (
                          <Chip hue={CONFIDENCE_HUES[confidence] ?? "slate"}>
                            {confidence.toLowerCase()}
                          </Chip>
                        )}
                        <MonoNote>score {asNumber(candidate.score)?.toFixed(2) ?? "?"}</MonoNote>
                      </div>
                      {reasons.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {reasons.join(" · ")}
                        </p>
                      )}
                      <MonoNote>
                        {asNumber(facts.bindingCount) ?? 0} bindings ·{" "}
                        {asNumber(facts.scheduleFieldCount) ?? 0} schedule fields ·{" "}
                        {asNumber(facts.placedScheduleFieldCount) ?? 0} placed
                      </MonoNote>
                    </div>
                  </div>
                );
              })}
              {candidates.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  no candidates
                </div>
              )}
            </div>
            {notes.length > 0 && <Provenance>{notes.join(" · ")}</Provenance>}
          </OpSection>
        );
      })}
      <Provenance>
        {asString(record.evidenceCollectedAtUtc)
          ? `evidence collected ${asString(record.evidenceCollectedAtUtc)}`
          : "collection time not reported"}
        {record.primitiveCacheHit === true ? " · cache hit" : ""}
        {pageNote(record) ? ` · ${pageNote(record)}` : ""}
      </Provenance>
      <IssuesNote data={record} />
    </div>
  );
}

/* ── revit.catalog.recent-documents — the Revit Home screen ───────────────── */

const DOC_KIND_HUES: Record<string, CatHue> = {
  rvt: "blue",
  rfa: "green",
  rte: "lichen",
};

function splitPath(path: string): { stem: string; ext: string; dir: string } {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
  const lastDot = file.lastIndexOf(".");
  return {
    stem: lastDot > 0 ? file.slice(0, lastDot) : file,
    ext: lastDot > 0 ? file.slice(lastDot + 1).toLowerCase() : "",
    dir,
  };
}

function RecentDocumentsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const documents = asRecords(record.documents);
  if (documents.length === 0)
    return <EmptyState note="no recent documents found in Revit.ini or the registry MRU" />;

  return (
    <OpSection label="Recent Documents" aside={<MonoNote>{documents.length} entries</MonoNote>}>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))" }}
      >
        {documents.map((doc, i) => {
          const path = asString(doc.path) ?? "";
          const { stem, ext, dir } = splitPath(path);
          const source = asString(doc.source);
          const rank = asNumber(doc.rank);
          const exists = doc.exists;
          return (
            <div
              key={path || `${i}`}
              className="min-w-0 px-2.5 py-2"
              style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}
              title={path}
            >
              <div className="flex items-baseline gap-1.5">
                <Chip hue={DOC_KIND_HUES[ext] ?? "slate"}>{ext || "?"}</Chip>
                {exists === false && <Chip hue="kiln">missing</Chip>}
              </div>
              <p className="mt-1 truncate text-sm font-medium" title={stem}>
                {asString(doc.title) || stem || "∅"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground" title={dir}>
                {dir || asString(doc.pathKind) || "—"}
              </p>
              <div className="mt-1">
                <MonoNote>
                  {source === "RevitIni"
                    ? "Revit.ini"
                    : source === "RegistryProfileMru"
                      ? "registry MRU"
                      : "?"}
                  {" · "}
                  {asString(doc.revitYear) ?? "?"}
                  {rank !== undefined ? ` · #${rank}` : ""}
                </MonoNote>
              </div>
            </div>
          );
        })}
      </div>
      <Provenance>
        read from this machine's Revit.ini and per-profile registry MRU — existence checked at read
        time, not proof the file still opens
      </Provenance>
    </OpSection>
  );
}

/* ── revit.catalog.field-options — the value domain ───────────────────────── */

const FIELD_OPTIONS_CAP = 60;

function FieldOptionsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <EmptyState note="unrecognized response shape" />;
  const items = asRecords(record.items);
  const mode = asString(record.mode);
  const shown = items.slice(0, FIELD_OPTIONS_CAP);

  return (
    <OpSection label="Field Options">
      <KVGrid
        columns={3}
        items={[
          { label: "source key", value: asString(record.sourceKey) ?? "∅" },
          { label: "mode", value: mode ?? "∅", hue: mode === "Constraint" ? "kiln" : "lichen" },
          {
            label: "custom values",
            value: record.allowsCustomValue === true ? "allowed" : "not allowed",
          },
        ]}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {shown.map((item) => {
          const value = asString(item.value) ?? "∅";
          const label = asString(item.label);
          const description = asString(item.description);
          return (
            <Chip key={value} hue="slate" title={[value, description].filter(Boolean).join(" — ")}>
              {label || value}
            </Chip>
          );
        })}
        {items.length > shown.length && <MonoNote>+{items.length - shown.length} more</MonoNote>}
        {items.length === 0 && <MonoNote>no option values in this domain</MonoNote>}
      </div>
      <Provenance>
        {items.length} values in domain
        {mode === "Suggestion" ? " · suggestions, not a closed set" : ""}
        {mode === "Constraint" ? " · closed constraint set" : ""}
      </Provenance>
    </OpSection>
  );
}

/* ── registry ─────────────────────────────────────────────────────────────── */

export const views: OpViewRegistry = {
  "revit.catalog.project-index": ProjectIndexView,
  "revit.catalog.project-browser": ProjectBrowserView,
  "revit.catalog.schedules": SchedulesView,
  "revit.catalog.loaded-families": LoadedFamiliesView,
  "revit.catalog.parameter-bindings": ParameterBindingsView,
  "revit.catalog.parameter-evidence": ParameterEvidenceView,
  "revit.catalog.concept-evidence": ConceptEvidenceView,
  "revit.catalog.recent-documents": RecentDocumentsView,
  "revit.catalog.field-options": FieldOptionsView,
};
