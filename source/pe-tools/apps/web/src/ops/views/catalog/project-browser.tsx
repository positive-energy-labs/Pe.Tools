import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { DataTable, type TreeNode, TreeView, VizChip } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";
import { ChipRow, Dash, IssuesNote, MonoAside, insertPath, pageNote, vizFor } from "./viz-cycle";

export function ProjectBrowserView({ data }: OpViewProps) {
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
        label: <span className="">{pathLabel}</span>,
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

export function SchedulesView({ data }: OpViewProps) {
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

export function LoadedFamiliesView({ data }: OpViewProps) {
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
