import type { ReactNode } from "react";
import { FactChip, type FactTone } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import {
  DataTable,
  KVGrid,
  type TreeNode,
  TreeView,
  VizChip,
  type VizIndex,
} from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
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

const VIZ_CYCLE: VizIndex[] = [1, 2, 3, 4, 5, 6];

/** Stable viz rung for an arbitrary name (categories, sections) — taxonomy by hash. */
function vizFor(name: string): VizIndex {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return VIZ_CYCLE[Math.abs(hash) % VIZ_CYCLE.length] ?? 3;
}

function MonoAside({ children }: { children: ReactNode }) {
  return <span className="face-mono t-caption text-ink-2">{children}</span>;
}

function Dash() {
  return <span className="text-ink-mute">—</span>;
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

/** Shared RevitDataIssue[] as quiet mono lines; severity is STATE, so caution ink —
 * never alarm (a data issue is not the model disagreeing). The word carries rank. */
function IssuesNote({ data }: { data: Record<string, unknown> }) {
  const issues = asRecords(data.issues);
  if (issues.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {issues.map((issue, i) => {
        const severity = asString(issue.severity) ?? "Info";
        return (
          <div key={`${asString(issue.code) ?? "issue"}-${i}`}>
            <span
              className="face-mono t-caption"
              style={{ color: severity === "Info" ? "var(--r-ink-2)" : "var(--r-caution)" }}
            >
              {severity.toLowerCase()} {asString(issue.code)}: {asString(issue.message)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Taxonomy chip row that caps display and says how many were left out. */
function ChipRow({
  values,
  viz = 3,
  max = 4,
}: {
  values: string[];
  viz?: VizIndex | ((value: string) => VizIndex);
  max?: number;
}) {
  if (values.length === 0) return <Dash />;
  const shown = values.slice(0, max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((value) => (
        <VizChip key={value} viz={typeof viz === "function" ? viz(value) : viz} title={value}>
          {value}
        </VizChip>
      ))}
      {values.length > max && <MonoAside>+{values.length - max}</MonoAside>}
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
  if (!record) return <UnrecognizedShape />;
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

  if (nodes.length === 0)
    return (
      <EmptyState story="scope" exit="request at least one section, or open a richer document">
        project index returned no sections
      </EmptyState>
    );
  return (
    <Section label="Project Index">
      <TreeView nodes={nodes} dense />
      <Provenance>
        {summary.truncated === true ? "index truncated by budget · " : ""}
        {pageNote(record) ?? "counts are index-time observations, not live proof"}
      </Provenance>
      <IssuesNote data={record} />
    </Section>
  );
}

/* ── revit.catalog.project-browser — the literal browser organization ─────── */

function ProjectBrowserView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
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

  if (roots.length === 0)
    return (
      <EmptyState story="scope" exit="open a document with a populated Project Browser">
        no browser organization returned
      </EmptyState>
    );
  return (
    <Section
      label="Project Browser"
      aside={
        <span title={asString(record.browserSnapshotId)}>
          <MonoAside>snapshot ·{(asString(record.browserSnapshotId) ?? "∅").slice(-8)}</MonoAside>
        </span>
      }
    >
      <TreeView nodes={roots} dense />
      <Provenance>
        view={asString(record.view) ?? "?"} · folder counts are indexed at snapshot time
        {pageNote(record) ? ` · ${pageNote(record)}` : ""}
      </Provenance>
      <IssuesNote data={record} />
    </Section>
  );
}

/* ── revit.catalog.schedules — the schedule grid about schedules ──────────── */

function SchedulesView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  const summary = asRecord(record.summary);

  const scopeChips = (entry: Record<string, unknown>): ReactNode => {
    const chips: ReactNode[] = [];
    if (entry.isTemplate === true)
      chips.push(
        <FactChip key="tpl" title="a schedule template, not a live schedule">
          template
        </FactChip>,
      );
    if (entry.isItemized === true)
      chips.push(
        <FactChip key="item" title="itemize every instance is on">
          itemized
        </FactChip>,
      );
    if (entry.filterBySheet === true)
      chips.push(
        <FactChip
          key="fbs"
          tone="caution"
          title="filter-by-sheet is on — row counts change with sheet placement"
        >
          filter-by-sheet
        </FactChip>,
      );
    if (asRecords(entry.filters).length > 0)
      chips.push(
        <FactChip key="filters" title="schedule filter count">
          {asRecords(entry.filters).length} filters
        </FactChip>,
      );
    return chips.length > 0 ? (
      <span className="inline-flex flex-wrap gap-1">{chips}</span>
    ) : (
      <Dash />
    );
  };

  return (
    <Section label="Schedule Catalog">
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
              return category ? <VizChip viz={vizFor(category)}>{category}</VizChip> : <Dash />;
            },
          },
          {
            key: "sheets",
            header: "Placed On",
            cell: (row) => (
              <ChipRow
                viz={1}
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
    </Section>
  );
}

/* ── revit.catalog.loaded-families — category → family → types ────────────── */

function LoadedFamiliesView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
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
          <VizChip viz={vizFor(category)}>{category}</VizChip>
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

  if (nodes.length === 0)
    return (
      <EmptyState story="filter" exit="widen the category/name filter, or load families first">
        no loaded families in scope
      </EmptyState>
    );
  return (
    <Section
      label="Loaded Families"
      aside={
        <>
          <MonoAside>{asNumber(summary.totalFamilies) ?? families.length} families</MonoAside>
          <MonoAside>{asNumber(summary.totalTypes) ?? "?"} types</MonoAside>
          <MonoAside>{asNumber(summary.totalPlacedInstances) ?? "?"} placed</MonoAside>
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
    </Section>
  );
}

/* ── revit.catalog.parameter-bindings — Project Parameters dialog ─────────── */

function ParameterBindingsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  const summary = asRecord(record.summary) ?? {};

  return (
    <Section label="Project Parameter Bindings">
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
              if (!kind) return <Dash />;
              // binding kind is taxonomy: instance vs type, colour by kind.
              return <VizChip viz={kind === "Instance" ? 3 : 6}>{kind}</VizChip>;
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
                viz={vizFor}
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
    </Section>
  );
}

/* ── revit.catalog.parameter-evidence — the evidence ledger ───────────────── */

/** Evidence SOURCE is taxonomy — a viz rung per source kind. */
const EVIDENCE_VIZ: Record<string, VizIndex> = {
  ProjectBinding: 1,
  ScheduleField: 2,
  ScheduleFilter: 4,
  ScopedElement: 5,
};

function ParameterEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const candidates = asRecords(record.candidates);
  const collectedAt = asString(record.evidenceCollectedAtUtc);

  return (
    <Section
      label="Parameter Evidence"
      aside={record.primitiveCacheHit === true ? <MonoAside>cache hit</MonoAside> : undefined}
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
              if (counts.length === 0) return <Dash />;
              return (
                <span className="inline-flex flex-wrap gap-1">
                  {counts.map((count, i) => {
                    const source = asString(count.source) ?? "?";
                    return (
                      <VizChip
                        key={`${source}-${asString(count.scope) ?? i}`}
                        viz={EVIDENCE_VIZ[source] ?? 3}
                        title={`${source} · scope ${asString(count.scope) ?? "?"} · ${asString(count.strength) ?? "?"}`}
                      >
                        {source} {asNumber(count.count) ?? "?"}
                      </VizChip>
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
                <Dash />
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
    </Section>
  );
}

/* ── revit.catalog.concept-evidence — ranked inferred candidates ──────────── */

/** Confidence is STATE (rank of trust), so it wears meaning tones, not viz. */
const CONFIDENCE_TONE: Record<string, FactTone> = {
  Low: "caution",
  Medium: "meta",
  High: "done",
};

function ConceptEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const concepts = asRecords(record.concepts);
  if (concepts.length === 0)
    return (
      <EmptyState story="scope" exit="name at least one concept in the request">
        no concepts inferred
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      {concepts.map((concept, ci) => {
        const conceptName = asString(concept.concept) ?? `concept ${ci + 1}`;
        const candidates = asRecords(concept.candidates);
        const notes = asArray(concept.evidenceNotes).flatMap((v) =>
          typeof v === "string" ? [v] : [],
        );
        return (
          <Section
            key={conceptName}
            label={conceptName}
            aside={<MonoAside>{candidates.length} candidates</MonoAside>}
          >
            <div className="rounded-md border border-line">
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
                    className={`flex min-w-0 items-baseline gap-2 px-2 py-1.5 hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))] ${i > 0 ? "border-t border-line" : ""}`}
                  >
                    <span className="face-mono t-value w-6 shrink-0 text-right text-ink-2">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="t-value font-medium">
                          {asString(identity?.name) ?? "∅"}
                        </span>
                        {confidence && (
                          <FactChip
                            tone={CONFIDENCE_TONE[confidence] ?? "meta"}
                            title="inference confidence, ranked by the host"
                          >
                            {confidence.toLowerCase()}
                          </FactChip>
                        )}
                        <MonoAside>score {asNumber(candidate.score)?.toFixed(2) ?? "?"}</MonoAside>
                      </div>
                      {reasons.length > 0 && (
                        <p className="t-label mt-0.5 text-ink-2">{reasons.join(" · ")}</p>
                      )}
                      <MonoAside>
                        {asNumber(facts.bindingCount) ?? 0} bindings ·{" "}
                        {asNumber(facts.scheduleFieldCount) ?? 0} schedule fields ·{" "}
                        {asNumber(facts.placedScheduleFieldCount) ?? 0} placed
                      </MonoAside>
                    </div>
                  </div>
                );
              })}
              {candidates.length === 0 && (
                <div className="t-label px-2 py-4 text-center italic text-ink-mute">
                  no candidates
                </div>
              )}
            </div>
            {notes.length > 0 && <Provenance>{notes.join(" · ")}</Provenance>}
          </Section>
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

/* ── revit.catalog.field-options — the value domain ───────────────────────── */

const FIELD_OPTIONS_CAP = 60;

function FieldOptionsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const items = asRecords(record.items);
  const mode = asString(record.mode);
  const shown = items.slice(0, FIELD_OPTIONS_CAP);

  return (
    <Section label="Field Options">
      <KVGrid
        columns={3}
        items={[
          { label: "source key", value: asString(record.sourceKey) ?? "∅" },
          { label: "mode", value: mode ?? "∅" },
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
            <FactChip key={value} title={[value, description].filter(Boolean).join(" — ")}>
              {label || value}
            </FactChip>
          );
        })}
        {items.length > shown.length && <MonoAside>+{items.length - shown.length} more</MonoAside>}
        {items.length === 0 && <MonoAside>no option values in this domain</MonoAside>}
      </div>
      <Provenance>
        {items.length} values in domain
        {mode === "Suggestion" ? " · suggestions, not a closed set" : ""}
        {mode === "Constraint" ? " · closed constraint set" : ""}
      </Provenance>
    </Section>
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
  "revit.catalog.field-options": FieldOptionsView,
};
