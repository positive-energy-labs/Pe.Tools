import { token } from "@pe/kit/lib/token";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export function handleId(handle: Record<string, unknown> | undefined): string {
  if (!handle) return "∅";
  const elementId = asNumber(handle.elementId);
  if (elementId !== undefined) return String(elementId);
  return asString(handle.uniqueId) ?? "∅";
}

function handleLabel(handle: Record<string, unknown> | undefined): string {
  return (handle && asString(handle.label)) || "∅";
}

export function HandleChip({ handle }: { handle: Record<string, unknown> }) {
  const kind = asString(handle.kind);
  return <FactChip title={`${kind ?? "?"} · ${handleId(handle)}`}>{handleLabel(handle)}</FactChip>;
}

function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function docKind(doc: Record<string, unknown>): string {
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

function DocFactChips({ doc }: { doc: Record<string, unknown> }) {
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
          <TooltipHint content={activeDoc ? text(activeDoc.title) : undefined}>
            <span className="min-w-0 truncate">
              {activeDoc ? text(activeDoc.title) : "no active document"}
            </span>
          </TooltipHint>
          {activeDoc && <span className="shrink-0">{docKind(activeDoc)}</span>}
        </div>
        {docPath && (
          <TooltipHint content={docPath}>
            <div className="mt-0.5">{truncateMiddle(docPath, 72)}</div>
          </TooltipHint>
        )}
        {activeDoc && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <DocFactChips doc={activeDoc} />
          </div>
        )}

        {activeView && (
          <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-2">
            <span className="">ON STAGE</span>
            <FactChip title="view kind">{text(activeView.viewType)}</FactChip>
            <TooltipHint content={text(activeView.title)}>
              <span className="min-w-0 truncate">{text(activeView.title)}</span>
            </TooltipHint>
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
              <TooltipHint
                content={p.isActiveSheet === true ? "this is the active sheet" : undefined}
                key={i}
              >
                <span
                  className=""
                  style={{
                    color: p.isActiveSheet === true ? token("ink") : token("ink-2"),
                  }}
                >
                  on {text(p.sheetNumber)} {text(p.sheetName)}
                </span>
              </TooltipHint>
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
                <FactChip key={i} title={handle ? handleId(handle) : "no handle"}>
                  {handle ? handleLabel(handle) : "?"} {text(cat.elementCount)}
                </FactChip>
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
