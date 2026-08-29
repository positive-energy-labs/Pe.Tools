import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { DataTable, VizChip } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";
import { DocFactChips, IssueLines, docKind, handleId, handleLabel } from "./kind-viz";

export function DocumentTab({ doc }: { doc: Record<string, unknown> }) {
  const isActive = doc.isActive === true;
  return (
    <div className="flex max-w-[18rem] min-w-0 flex-col gap-0.5 px-2.5 py-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 truncate" title={text(doc.title)}>
          {text(doc.title)}
        </span>
        <span className="shrink-0">{docKind(doc)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {isActive && <FactChip title="this document has focus in Revit">active</FactChip>}
        <DocFactChips doc={doc} />
      </div>
    </div>
  );
}

export function DocumentSessionView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.openDocuments)) return <UnrecognizedShape />;
  const docs = asRecords(res.openDocuments);

  return (
    <div className="flex flex-col gap-3">
      <Section label="open documents" aside={<span>{text(res.openDocumentCount)} open</span>}>
        {docs.length === 0 ? (
          <EmptyState story="scope" exit="open a document in the connected Revit session">
            no documents open
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {docs.map((doc) => (
              <DocumentTab key={text(doc.documentKey)} doc={doc} />
            ))}
          </div>
        )}
        {res.hasActiveDocument !== true && docs.length > 0 && (
          <Provenance>no active document — Revit has documents open but none focused</Provenance>
        )}
      </Section>
    </div>
  );
}

export type VisibleCategoryRow = Record<string, unknown>;

export function VisibleSummaryView({ data, request }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.categories)) return <UnrecognizedShape />;
  const categories = asRecords(res.categories);
  const activeView = asRecord(res.activeView);
  const views = asRecords(res.views);
  const req = asRecord(request) ?? {};

  const truncated = categories.filter((c) => c.isReturnedElementSetComplete === false);
  const reqEchoes = (
    [
      "maxCategories",
      "maxViews",
      "maxElementHandlesPerCategory",
      "maxSampleElementsPerCategory",
    ] as const
  )
    .map((key) => {
      const v = asNumber(req[key]);
      return v !== undefined ? `${key}=${v}` : undefined;
    })
    .filter((s): s is string => !!s);

  const columns = [
    {
      key: "category",
      header: "Category",
      cell: (row: VisibleCategoryRow) => {
        const handle = asRecord(row.handle);
        return (
          <span title={handle ? handleId(handle) : undefined}>
            {handle ? handleLabel(handle) : "?"}
          </span>
        );
      },
    },
    {
      key: "count",
      header: "Count",
      numeric: true,
      cell: (row: VisibleCategoryRow) => text(row.elementCount),
      width: 72,
    },
    {
      key: "samples",
      header: "Sample ids",
      cell: (row: VisibleCategoryRow) => {
        const handles = asRecords(row.elementHandles).map((h) => asRecord(h.handle));
        const samples =
          handles.length > 0
            ? handles
            : asRecords(row.sampleElements).map((s) => asRecord(s.handle));
        if (samples.length === 0) return <span className="">∅</span>;
        const ids = samples.map((h) => handleId(h ?? undefined));
        const complete = row.isReturnedElementSetComplete === true;
        return (
          <span title={complete ? undefined : "returned element set is incomplete"}>
            {ids.join(" ")}
            {!complete && " …"}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <DataTable
        title={activeView ? `Visible in ${handleLabel(activeView)}` : "Visible elements"}
        columns={columns}
        rows={categories}
        rowKey={(row: VisibleCategoryRow, i: number) => {
          const handle = asRecord(row.handle);
          return handle ? `${handleId(handle)}-${handleLabel(handle)}` : String(i);
        }}
        footer={
          <span className="">
            {text(res.totalVisibleElementCount)} visible elements · {categories.length} categories
          </span>
        }
      />
      {views.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {views.map((view, i) => {
            const handle = asRecord(view.handle);
            return (
              <VizChip key={i} viz={1} title={handle ? handleId(handle) : undefined}>
                {text(view.title)} {text(view.elementCount)}
              </VizChip>
            );
          })}
        </div>
      )}
      <Provenance>
        {truncated.length > 0
          ? `${truncated.length} of ${categories.length} categories returned incomplete element sets · `
          : "returned element sets complete for all categories · "}
        {reqEchoes.length > 0
          ? `request limits: ${reqEchoes.join(" ")}`
          : "request limits: defaults"}
      </Provenance>
      <IssueLines issues={res.issues} />
    </div>
  );
}

export function viewRangeItems(
  range: Record<string, unknown>,
): { label: string; value: ReactNode }[] {
  const entry = (label: string, levelKey: string, offsetKey: string) => {
    const level = asString(range[levelKey]);
    const offset = asNumber(range[offsetKey]);
    const value =
      level === undefined && offset === undefined
        ? "∅"
        : `${level ?? "?"}${offset !== undefined ? ` ${offset >= 0 ? "+" : ""}${offset.toFixed(2)}` : ""}`;
    return { label, value };
  };
  return [
    entry("top", "topLevelName", "topOffset"),
    entry("cut plane", "cutLevelName", "cutOffset"),
    entry("bottom", "bottomLevelName", "bottomOffset"),
    entry("view depth", "viewDepthLevelName", "viewDepthOffset"),
  ];
}
