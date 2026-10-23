import { EmptyState } from "@pe/kit/lang/empty";
import { Provenance, Section } from "@pe/kit/lang/section";
import { type TreeNode, TreeView } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";
import { IssuesNote, insertPath, pageNote } from "./viz-cycle";

/** I1: a handle's element id is never printed; it rides the row for the element menu. */
const idsOf = (handle: Record<string, unknown> | undefined) => {
  const id = asNumber(handle?.elementId);
  return id === undefined ? undefined : [id];
};

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
        label: pathLabel,
        meta: `${asNumber(folder.elementCount) ?? 0}`,
        children: asRecords(folder.sampleHandles).map((h, i) => ({
          id: `org/${section}/folder/${pathLabel}/sample/${i}`,
          label: asString(h.label) ?? "∅",
          revitIds: idsOf(h),
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
      revitIds: idsOf(handle),
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
    <Section label="Project Browser">
      <TreeView nodes={roots} label="project browser" />
      <Provenance>
        view={asString(record.view) ?? "?"} · folder counts are indexed at snapshot time
        {pageNote(record) ? ` · ${pageNote(record)}` : ""} · snapshot{" "}
        <span className="face-mono">{asString(record.browserSnapshotId) ?? "∅"}</span>
      </Provenance>
      <IssuesNote data={record} />
    </Section>
  );
}
