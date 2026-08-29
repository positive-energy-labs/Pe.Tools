import { token } from "#/lib/token";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, VizChip, type VizIndex } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";

export const KIND_VIZ: Record<string, VizIndex> = {
  Document: 3,
  View: 1,
  Sheet: 2,
  Schedule: 3,
  Element: 5,
  Category: 4,
  Family: 6,
};

export function kindViz(kind: string | undefined): VizIndex {
  return (kind && KIND_VIZ[kind]) || 3;
}

export function handleId(handle: Record<string, unknown> | undefined): string {
  if (!handle) return "∅";
  const elementId = asNumber(handle.elementId);
  if (elementId !== undefined) return String(elementId);
  return asString(handle.uniqueId) ?? "∅";
}

export function handleLabel(handle: Record<string, unknown> | undefined): string {
  return (handle && asString(handle.label)) || "∅";
}

export function HandleChip({ handle }: { handle: Record<string, unknown> }) {
  const kind = asString(handle.kind);
  return (
    <VizChip viz={kindViz(kind)} title={`${kind ?? "?"} · ${handleId(handle)}`}>
      {handleLabel(handle)}
    </VizChip>
  );
}

export function provenanceDescriptions(value: unknown): string[] {
  return asRecords(value)
    .map((p) => asString(p.description))
    .filter((d): d is string => !!d);
}

export function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function docKind(doc: Record<string, unknown>): string {
  return doc.isFamilyDocument === true ? "rfa" : "rvt";
}

export function IssueLines({ issues }: { issues: unknown }) {
  const rows = asRecords(issues);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {rows.map((issue, i) => (
        <span
          key={i}
          className=""
          style={{
            color: issue.severity === "Info" ? token("ink-2") : token("caution"),
          }}
        >
          {text(issue.severity)} {text(issue.code)}: {text(issue.message)}
        </span>
      ))}
    </div>
  );
}

export function DocFactChips({ doc }: { doc: Record<string, unknown> }) {
  return (
    <>
      {doc.isWorkshared === true && (
        <FactChip title="worksharing is enabled on this document">workshared</FactChip>
      )}
      {doc.isModelInCloud === true && (
        <FactChip title="this model lives in the cloud">cloud</FactChip>
      )}
      {doc.isReadOnly === true && (
        <FactChip tone="caution" title="document is read-only — no write can land">
          read-only
        </FactChip>
      )}
      {doc.isModifiable === false && doc.isReadOnly !== true && (
        <FactChip tone="caution" title="document is not modifiable right now">
          not modifiable
        </FactChip>
      )}
    </>
  );
}

export function ContextSummaryView({ data }: OpViewProps) {
  const res = asRecord(data);
  const documents = res && asRecord(res.documents);
  if (!res || !documents) return <UnrecognizedShape />;

  const activeDoc = asRecord(documents.activeDocument);
  const activeView = asRecord(res.activeView);
  const selection = asRecord(res.selection) ?? {};
  const browser = asRecord(res.browser) ?? {};
  const visibleCategories = asRecords(res.visibleCategories);

  const selectedCount = asNumber(selection.selectedElementCount) ?? 0;
  const returnedCount = asNumber(selection.returnedElementCount) ?? 0;
  const sheetPlacements = activeView ? asRecords(activeView.sheetPlacements) : [];

  const docPath = activeDoc && asString(activeDoc.path);

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0 px-4 py-3">
        <div className="">DOCUMENT</div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate" title={activeDoc ? text(activeDoc.title) : undefined}>
            {activeDoc ? text(activeDoc.title) : "no active document"}
          </span>
          {activeDoc && <span className="shrink-0">{docKind(activeDoc)}</span>}
        </div>
        {docPath && (
          <div className="mt-0.5" title={docPath}>
            {truncateMiddle(docPath, 72)}
          </div>
        )}
        {activeDoc && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <DocFactChips doc={activeDoc} />
          </div>
        )}

        {activeView && (
          <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-2">
            <span className="">ON STAGE</span>
            <VizChip viz={activeView.isSheet === true ? 2 : 1} title="view kind">
              {text(activeView.viewType)}
            </VizChip>
            <span className="min-w-0 truncate" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <span className="">1:{text(activeView.scale)}</span>
            {asString(activeView.levelName) && (
              <FactChip title="level of the active view">{text(activeView.levelName)}</FactChip>
            )}
            {asString(activeView.viewTemplateName) && (
              <FactChip title="view template applied to the active view">
                {text(activeView.viewTemplateName)}
              </FactChip>
            )}
            {sheetPlacements.map((p, i) => (
              <span
                key={i}
                className=""
                style={{
                  color: p.isActiveSheet === true ? token("ink") : token("ink-2"),
                }}
                title={p.isActiveSheet === true ? "this is the active sheet" : undefined}
              >
                on {text(p.sheetNumber)} {text(p.sheetName)}
              </span>
            ))}
          </div>
        )}
      </div>

      <Section label="session">
        <KVGrid
          columns={3}
          items={[
            { label: "selection", value: `${selectedCount} selected` },
            { label: "open documents", value: text(documents.openDocumentCount) },
            { label: "views", value: text(browser.viewCount) },
            { label: "sheets", value: text(browser.sheetCount) },
            { label: "schedules", value: text(browser.scheduleCount) },
            { label: "families", value: text(browser.familyCount) },
          ]}
        />
        {selectedCount !== returnedCount && (
          <Provenance>
            selection: {returnedCount} of {selectedCount} entries returned
          </Provenance>
        )}
      </Section>

      <Section
        label="visible categories"
        aside={<span>{visibleCategories.length} categories</span>}
      >
        {visibleCategories.length === 0 ? (
          <EmptyState story="scope" exit="open a view with model elements and re-run">
            no visible categories reported
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-1">
            {visibleCategories.map((cat, i) => {
              const handle = asRecord(cat.handle);
              return (
                <VizChip key={i} viz={4} title={handle ? handleId(handle) : undefined}>
                  {handle ? handleLabel(handle) : "?"} {text(cat.elementCount)}
                </VizChip>
              );
            })}
          </div>
        )}
        <Provenance>
          scope: active view · counts are observed at call time, not proven complete
        </Provenance>
      </Section>
    </div>
  );
}
