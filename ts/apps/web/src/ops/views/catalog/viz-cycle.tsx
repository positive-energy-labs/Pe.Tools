import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { type TreeNode, TreeView } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";

export function MonoAside({ children }: { children: ReactNode }) {
  return <span className="">{children}</span>;
}

export function pageNote(data: Record<string, unknown>): string | undefined {
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

export function IssuesNote({ data }: { data: Record<string, unknown> }) {
  const issues = asRecords(data.issues);
  if (issues.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {issues.map((issue, i) => {
        const severity = asString(issue.severity) ?? "Info";
        return (
          <div key={`${asString(issue.code) ?? "issue"}-${i}`}>
            <span
              className=""
              style={{ color: severity === "Info" ? token("ink-2") : token("caution") }}
            >
              {severity.toLowerCase()} {asString(issue.code)}: {asString(issue.message)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function insertPath(
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
        label: <span className="">{segment}</span>,
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

type IndexSection = {
  key: string;
  label: string;
  count: number | undefined;
  entries: Record<string, unknown>[];
  toNode: (entry: Record<string, unknown>, i: number) => TreeNode;
};

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

export function ProjectIndexView({ data }: OpViewProps) {
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
