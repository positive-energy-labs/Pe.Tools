import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { DataTable, KVGrid, type KVTone, VizChip, type VizIndex } from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";

/**
 * Curated readonly views for the revit.context.* orientation ops and
 * revit.resolve.references. Testimony surfaces: what the connected Revit
 * session looks like right now, with limits and caveats quoted verbatim.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

/** Handle KIND is taxonomy — the viz ladder, by index. Series identity carries the
 * old cat hues forward (blue→1 green→2 slate→3 lichen→4 clay→5 kiln→6). */
const KIND_VIZ: Record<string, VizIndex> = {
  Document: 3,
  View: 1,
  Sheet: 2,
  Schedule: 3,
  Element: 5,
  Category: 4,
  Family: 6,
};

function kindViz(kind: string | undefined): VizIndex {
  return (kind && KIND_VIZ[kind]) || 3;
}

/** id string for a context handle: elementId first, then uniqueId, then ∅. */
function handleId(handle: Record<string, unknown> | undefined): string {
  if (!handle) return "∅";
  const elementId = asNumber(handle.elementId);
  if (elementId !== undefined) return String(elementId);
  return asString(handle.uniqueId) ?? "∅";
}

function handleLabel(handle: Record<string, unknown> | undefined): string {
  return (handle && asString(handle.label)) || "∅";
}

/** kind-tinted taxonomy chip for a context handle. */
function HandleChip({ handle }: { handle: Record<string, unknown> }) {
  const kind = asString(handle.kind);
  return (
    <VizChip viz={kindViz(kind)} title={`${kind ?? "?"} · ${handleId(handle)}`}>
      {handleLabel(handle)}
    </VizChip>
  );
}

function provenanceDescriptions(value: unknown): string[] {
  return asRecords(value)
    .map((p) => asString(p.description))
    .filter((d): d is string => !!d);
}

/** middle-truncate long machine paths so the drive and filename both survive. */
function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function docKind(doc: Record<string, unknown>): string {
  return doc.isFamilyDocument === true ? "rfa" : "rvt";
}

/** Host-reported data issues. Severity is STATE: caution ink (a busy bridge is not the
 * model disagreeing — nothing here earns the one alarm); the severity word carries rank. */
function IssueLines({ issues }: { issues: unknown }) {
  const rows = asRecords(issues);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {rows.map((issue, i) => (
        <span
          key={i}
          className="face-mono t-caption"
          style={{
            color: issue.severity === "Info" ? "var(--r-ink-2)" : "var(--r-caution)",
          }}
        >
          {text(issue.severity)} {text(issue.code)}: {text(issue.message)}
        </span>
      ))}
    </div>
  );
}

/** Machine-fact chips shared by every document rendering. */
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

/* ── revit.context.summary — the orientation card ─────────────────────────── */

function ContextSummaryView({ data }: OpViewProps) {
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
      {/* hero: document identity large, chips beneath, active-view stage line —
          Revit's window chrome distilled to a title block */}
      <div className="min-w-0 rounded-md border border-line-2 px-4 py-3">
        <div className="face-mono t-caption uppercase tracking-[0.3em] text-ink-2">DOCUMENT</div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <span
            className="t-title min-w-0 truncate leading-tight"
            title={activeDoc ? text(activeDoc.title) : undefined}
          >
            {activeDoc ? text(activeDoc.title) : "no active document"}
          </span>
          {activeDoc && (
            <span className="face-mono t-caption shrink-0 text-ink-2">{docKind(activeDoc)}</span>
          )}
        </div>
        {docPath && (
          <div className="face-mono t-caption mt-0.5 text-ink-2" title={docPath}>
            {truncateMiddle(docPath, 72)}
          </div>
        )}
        {activeDoc && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <DocFactChips doc={activeDoc} />
          </div>
        )}

        {/* stage line: where the camera is right now */}
        {activeView && (
          <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-line pt-2">
            <span className="face-mono t-caption uppercase tracking-[0.08em] text-ink-2">
              ON STAGE
            </span>
            <VizChip viz={activeView.isSheet === true ? 2 : 1} title="view kind">
              {text(activeView.viewType)}
            </VizChip>
            <span className="t-value min-w-0 truncate font-medium" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <span className="face-mono t-value text-ink-2">1:{text(activeView.scale)}</span>
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
                className="face-mono t-caption"
                style={{
                  color: p.isActiveSheet === true ? "var(--r-ink)" : "var(--r-ink-2)",
                }}
                title={p.isActiveSheet === true ? "this is the active sheet" : undefined}
              >
                on {text(p.sheetNumber)} {text(p.sheetName)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* status bar: selection + project browser counts */}
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
        aside={
          <span className="face-mono t-caption text-ink-2">
            {visibleCategories.length} categories
          </span>
        }
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

/* ── revit.context.document-session — the document tab row ────────────────── */

function DocumentTab({ doc }: { doc: Record<string, unknown> }) {
  const isActive = doc.isActive === true;
  return (
    <div
      className={`flex max-w-[18rem] min-w-0 flex-col gap-0.5 rounded-md border px-2.5 py-1.5 ${isActive ? "border-line-2" : "border-line"}`}
      /* selection is a fill, never a hue — the active tab takes the select rung and
         re-declares the ground it shifted. */
      style={
        isActive
          ? ({ background: "var(--r-select)", "--r-on": "var(--r-select)" } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={`t-value min-w-0 truncate ${isActive ? "font-medium" : ""}`}
          title={text(doc.title)}
        >
          {text(doc.title)}
        </span>
        <span className="face-mono t-caption shrink-0 text-ink-2">{docKind(doc)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {isActive && <FactChip title="this document has focus in Revit">active</FactChip>}
        <DocFactChips doc={doc} />
      </div>
    </div>
  );
}

function DocumentSessionView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.openDocuments)) return <UnrecognizedShape />;
  const docs = asRecords(res.openDocuments);

  return (
    <div className="flex flex-col gap-3">
      <Section
        label="open documents"
        aside={
          <span className="face-mono t-caption text-ink-2">{text(res.openDocumentCount)} open</span>
        }
      >
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

/* ── revit.context.visible-summary — visible elements by category ─────────── */

type VisibleCategoryRow = Record<string, unknown>;

function VisibleSummaryView({ data, request }: OpViewProps) {
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
        if (samples.length === 0) return <span className="face-mono t-caption text-ink-2">∅</span>;
        const ids = samples.map((h) => handleId(h ?? undefined));
        const complete = row.isReturnedElementSetComplete === true;
        return (
          <span
            className="face-mono t-caption"
            style={{ color: complete ? "var(--r-ink-2)" : "var(--r-caution)" }}
            title={complete ? undefined : "returned element set is incomplete"}
          >
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
          <span className="face-mono t-caption text-ink-2">
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

/* ── revit.context.view-rendering-state — V/G-flavored evidence card ──────── */

function viewRangeItems(range: Record<string, unknown>): { label: string; value: ReactNode }[] {
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

function ObservedViewCard({ view }: { view: Record<string, unknown> }) {
  const planViewRange = asRecord(view.planViewRange);
  const view3D = asRecord(view.view3D);
  const filters = asRecords(view.filters);
  const hiddenCategories = asRecords(view.hiddenCategories);
  const links = asRecords(view.links);
  const worksets = asRecords(view.worksets);
  const provenance = provenanceDescriptions(view.provenance);

  const stateItems: { label: string; value: ReactNode; tone?: KVTone }[] = [
    { label: "scale", value: `1:${text(view.scale)}` },
    { label: "detail level", value: text(view.detailLevel) || "∅" },
    { label: "display style", value: text(view.displayStyle) || "∅" },
    { label: "discipline", value: text(view.discipline) || "∅" },
    { label: "phase", value: text(view.phaseName) || "∅" },
    { label: "phase filter", value: text(view.phaseFilterName) || "∅" },
    {
      label: "crop box",
      value: view.cropBoxActive == null ? "∅" : view.cropBoxActive ? "active" : "off",
    },
    { label: "scope box", value: text(view.scopeBoxName) || "∅" },
    {
      label: "temp hide/isolate",
      value:
        view.temporaryHideIsolateActive == null
          ? "∅"
          : view.temporaryHideIsolateActive
            ? "ACTIVE"
            : "off",
      tone: view.temporaryHideIsolateActive === true ? "caution" : undefined,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md border border-line px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <VizChip viz={1} title="view kind">
          {text(view.viewType)}
        </VizChip>
        <span className="t-value min-w-0 truncate font-medium" title={text(view.title)}>
          {text(view.title)}
        </span>
        {asString(view.viewTemplateName) && (
          <FactChip title="view template applied to this view">
            {text(view.viewTemplateName)}
          </FactChip>
        )}
        {view.areGraphicsOverridesAllowed === false && (
          <FactChip tone="caution" title="graphics overrides are disallowed on this view">
            overrides disallowed
          </FactChip>
        )}
        <span className="face-mono t-caption text-ink-2">
          {text(view.candidateVisibleElementCount)} candidate visible ·{" "}
          {text(view.viewOwnedElementCount)} view-owned
        </span>
      </div>

      <Section label="graphics state">
        <KVGrid columns={3} items={stateItems} />
      </Section>

      {planViewRange && (
        <Section label="view range">
          <KVGrid columns={2} items={viewRangeItems(planViewRange)} />
        </Section>
      )}

      {view3D && (
        <Section label="3d state">
          <KVGrid
            columns={3}
            items={[
              {
                label: "projection",
                value: view3D.isPerspective === true ? "perspective" : "orthographic",
              },
              {
                label: "section box",
                value:
                  view3D.isSectionBoxActive == null
                    ? "∅"
                    : view3D.isSectionBoxActive
                      ? "active"
                      : "off",
              },
              {
                label: "locked",
                value: view3D.isLocked == null ? "∅" : view3D.isLocked ? "yes" : "no",
              },
            ]}
          />
        </Section>
      )}

      <Section
        label="filters"
        aside={<span className="face-mono t-caption text-ink-2">{filters.length}</span>}
      >
        {filters.length === 0 ? (
          <span className="face-mono t-caption text-ink-2">no view filters applied</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {filters.map((filter, i) => {
              const fh = asRecord(filter.handle);
              const visible = filter.isVisible;
              return (
                <FactChip
                  key={i}
                  tone={visible === false ? "caution" : "meta"}
                  title={`${text(filter.elementFilterType) || "filter"} · ${asNumber(filter.categoryCount) ?? "?"} categories`}
                >
                  {fh ? handleLabel(fh) : "?"}{" "}
                  {visible == null ? "?" : visible ? "shown" : "hidden"}
                </FactChip>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        label="hidden categories"
        aside={<span className="face-mono t-caption text-ink-2">{hiddenCategories.length}</span>}
      >
        {hiddenCategories.length === 0 ? (
          <span className="face-mono t-caption text-ink-2">none hidden</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {hiddenCategories.map((cat, i) => {
              const ch = asRecord(cat.handle);
              return (
                <FactChip
                  key={i}
                  tone="caution"
                  title={`hidden in this view${asString(cat.categoryType) ? ` · ${text(cat.categoryType)}` : ""}`}
                >
                  {ch ? handleLabel(ch) : "?"}
                </FactChip>
              );
            })}
          </div>
        )}
      </Section>

      {links.length > 0 && (
        <Section
          label="links"
          aside={<span className="face-mono t-caption text-ink-2">{links.length}</span>}
        >
          <div className="flex flex-wrap gap-1">
            {links.map((link, i) => {
              const lh = asRecord(link.handle);
              const hidden = link.isHiddenInView === true;
              const unloaded = link.isLoaded === false;
              return (
                <FactChip
                  key={i}
                  tone={hidden || unloaded ? "caution" : "meta"}
                  title={text(link.linkVisibilityType) || "linked model"}
                >
                  {lh ? handleLabel(lh) : "?"}
                  {hidden && " hidden"}
                  {unloaded && " unloaded"}
                </FactChip>
              );
            })}
          </div>
        </Section>
      )}

      {worksets.length > 0 && (
        <Section
          label="worksets"
          aside={<span className="face-mono t-caption text-ink-2">{worksets.length}</span>}
        >
          <div className="flex flex-wrap gap-1">
            {worksets.map((workset, i) => (
              <FactChip
                key={i}
                tone={text(workset.visibility) === "Hidden" ? "caution" : "meta"}
                title="workset visibility in this view"
              >
                {text(workset.name)} {text(workset.visibility).toLowerCase()}
              </FactChip>
            ))}
          </div>
        </Section>
      )}

      {provenance.length > 0 && <Provenance>{provenance.join(" · ")}</Provenance>}
    </div>
  );
}

function ViewRenderingStateView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.observedState)) return <UnrecognizedShape />;
  const observed = asRecords(res.observedState);
  const notInspected = asArray(res.notInspected).map(text).filter(Boolean);
  const apiLimitations = asArray(res.apiLimitations).map(text).filter(Boolean);
  const confidenceWarnings = asArray(res.confidenceWarnings).map(text).filter(Boolean);
  const nextSteps = asArray(res.likelyInspectionNextSteps).map(text).filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {observed.length === 0 ? (
        <EmptyState story="scope" exit="open a view in Revit, or name one in the request">
          no views observed
        </EmptyState>
      ) : (
        observed.map((view, i) => {
          const handle = asRecord(view.handle);
          return <ObservedViewCard key={handle ? handleId(handle) : i} view={view} />;
        })
      )}

      {/* the honesty block: this op's whole point is explicit limitations */}
      <Section label="evidence limits">
        {confidenceWarnings.map((warning, i) => (
          <Provenance key={`w${i}`}>
            <span style={{ color: "var(--r-caution)" }}>confidence: {warning}</span>
          </Provenance>
        ))}
        {notInspected.map((item, i) => (
          <Provenance key={`n${i}`}>not inspected: {item}</Provenance>
        ))}
        {apiLimitations.map((item, i) => (
          <Provenance key={`a${i}`}>api limitation: {item}</Provenance>
        ))}
        {nextSteps.map((item, i) => (
          <Provenance key={`s${i}`}>next: {item}</Provenance>
        ))}
        {notInspected.length + apiLimitations.length + confidenceWarnings.length === 0 && (
          <Provenance>no limitations reported by the host for this observation</Provenance>
        )}
      </Section>
      <IssueLines issues={res.issues} />
    </div>
  );
}

/* ── revit.resolve.references — resolution testimony ──────────────────────── */

/** Thin normalized score bar + raw mono number. Scores are ints with no fixed
 * ceiling, so the bar is honest only relative to the best score in this set.
 * One series, so the fill spends viz-1; a demoted candidate goes mute ink. */
function ScoreBar({ score, max, muted }: { score: number; max: number; muted: boolean }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`score ${score} of max ${max} in this set`}
    >
      <span className="inline-block h-[3px] w-[72px] rounded-[1px] bg-line">
        <span
          className="block h-full rounded-[1px]"
          style={{
            width: `${frac * 100}%`,
            background: muted ? "var(--r-ink-mute)" : "var(--viz-1)",
          }}
        />
      </span>
      <span
        className="face-mono t-caption"
        style={{ color: muted ? "var(--r-ink-mute)" : undefined }}
      >
        {score}
      </span>
    </span>
  );
}

function ResolveReferencesView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.candidates)) return <UnrecognizedShape />;
  const candidates = [...asRecords(res.candidates)].sort(
    (a, b) => (asNumber(b.score) ?? 0) - (asNumber(a.score) ?? 0),
  );
  const candidateCount = asNumber(res.candidateCount) ?? candidates.length;
  const ambiguous = candidateCount > 1;
  const maxScore = candidates.reduce((acc, c) => Math.max(acc, asNumber(c.score) ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* testimony header: the phrase under interrogation */}
      <div className="min-w-0">
        <div className="face-mono t-caption uppercase tracking-[0.3em] text-ink-2">REFERENCE</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="t-title min-w-0 font-medium leading-snug">
            “{text(res.referenceText)}”
          </span>
          <span
            className="face-mono t-caption"
            style={{
              color:
                candidateCount === 1
                  ? "var(--r-done)"
                  : candidateCount === 0
                    ? "var(--r-caution)"
                    : "var(--r-caution)",
            }}
          >
            {candidateCount === 0
              ? "no matches"
              : candidateCount === 1
                ? "resolved"
                : `${candidateCount} candidates — ambiguous`}
          </span>
        </div>
      </div>

      {candidates.length === 0 ? (
        <EmptyState
          story="scope"
          exit="loosen the reference text, or check the model has the thing"
        >
          nothing in the model matched this reference
        </EmptyState>
      ) : (
        <div className="flex flex-col rounded-md border border-line">
          {candidates.map((candidate, i) => {
            const handle = asRecord(candidate.handle);
            const related = asRecords(candidate.relatedHandles);
            const provenance = asRecords(candidate.provenance);
            const score = asNumber(candidate.score);
            const top = i === 0;
            /* rank is carried by order, the #n gutter and the score bar (grayscale law).
               The edge mark only locates: ink for the leader (R13a's neutral locate mark),
               caution for a demoted candidate in an ambiguous set. */
            const edge = top ? "var(--r-ink)" : ambiguous ? "var(--r-caution)" : "transparent";
            return (
              <div
                key={handle ? `${handleId(handle)}-${i}` : i}
                className={`flex min-w-0 flex-col gap-1 border-l-2 px-2.5 py-2 ${i < candidates.length - 1 ? "border-b border-b-line" : ""}`}
                style={{ borderLeftColor: edge }}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="face-mono t-caption w-6 shrink-0 text-ink-2">#{i + 1}</span>
                  {handle && <HandleChip handle={handle} />}
                  <span className={`t-value min-w-0 truncate ${top ? "font-medium" : ""}`}>
                    {text(candidate.label)}
                  </span>
                  {handle && (
                    <span className="face-mono t-caption text-ink-2">{handleId(handle)}</span>
                  )}
                  {score !== undefined && (
                    <span className="ml-auto">
                      <ScoreBar score={score} max={maxScore} muted={!top && ambiguous} />
                    </span>
                  )}
                </div>
                {related.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pl-6">
                    {related.map((rel, j) => (
                      <HandleChip key={j} handle={rel} />
                    ))}
                  </div>
                )}
                {provenance.length > 0 && (
                  <details className="pl-6">
                    <summary className="face-mono t-caption cursor-pointer select-none text-ink-2">
                      provenance ({provenance.length})
                    </summary>
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {provenance.map((p, j) => (
                        <Provenance key={j}>
                          {asString(p.kind) ? `${text(p.kind)} — ` : ""}
                          {text(p.description) || text(p)}
                        </Provenance>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      {candidates.length > 0 && (
        <Provenance>
          ranked by score, descending · bars normalized against the best score in this set (
          {maxScore}) — scores are relative evidence, not absolute confidence
        </Provenance>
      )}
      <IssueLines issues={res.issues} />
    </div>
  );
}

/* ── revit.context.view-image — the export result ─────────────────────────── */

function ViewImageView({ data }: OpViewProps) {
  const res = asRecord(data);
  const filePath = res && asString(res.filePath);
  if (!res || !filePath) return <UnrecognizedShape />;

  const view = asRecord(res.view);
  const modelRect = asRecord(res.modelRect);
  const byteSize = asNumber(res.byteSize);
  const viewScale = asNumber(res.viewScale);
  const sheetNumber = asString(res.sheetNumber);

  const items: { label: string; value: ReactNode; tone?: KVTone }[] = [
    { label: "view", value: view ? handleLabel(view) : "∅" },
    { label: "pixel size", value: `${text(res.pixelSize)} px (long edge)` },
    { label: "file size", value: byteSize !== undefined ? formatBytes(byteSize) : "∅" },
  ];
  if (viewScale !== undefined) items.push({ label: "view scale", value: `1:${viewScale}` });
  if (sheetNumber) items.push({ label: "sheet", value: sheetNumber });

  return (
    <div className="flex flex-col gap-4">
      <Section label="exported image">
        <KVGrid columns={3} items={items} />
        <div className="mt-2">
          <div className="t-label text-ink-2">file path</div>
          <div className="face-mono t-value" title={filePath}>
            {truncateMiddle(filePath, 72)}
          </div>
        </div>
      </Section>

      {modelRect && (
        <Section label="model extent">
          <KVGrid
            columns={2}
            items={[
              { label: "min (x, y)", value: `${text(modelRect.minX)}, ${text(modelRect.minY)} ft` },
              { label: "max (x, y)", value: `${text(modelRect.maxX)}, ${text(modelRect.maxY)} ft` },
            ]}
          />
        </Section>
      )}

      <Provenance>
        path is local to the Revit host machine — not fetchable from this browser
        {modelRect
          ? " · model extent in feet, project internal coordinates"
          : " · no model extent reported (sheet or schedule capture)"}
      </Provenance>
    </div>
  );
}

/* ── registry ─────────────────────────────────────────────────────────────── */

export const views: OpViewRegistry = {
  "revit.context.summary": ContextSummaryView,
  "revit.context.document-session": DocumentSessionView,
  "revit.context.visible-summary": VisibleSummaryView,
  "revit.context.view-rendering-state": ViewRenderingStateView,
  "revit.resolve.references": ResolveReferencesView,
  "revit.context.view-image": ViewImageView,
};
