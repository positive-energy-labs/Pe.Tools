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
} from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
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

const KIND_HUE: Record<string, CatHue> = {
  Document: "slate",
  View: "blue",
  Sheet: "green",
  Schedule: "slate",
  Element: "clay",
  Category: "lichen",
  Family: "kiln",
};

function kindHue(kind: string | undefined): CatHue {
  return (kind && KIND_HUE[kind]) || "slate";
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

/** kind-tinted chip for a context handle. */
function HandleChip({ handle }: { handle: Record<string, unknown> }) {
  const kind = asString(handle.kind);
  return (
    <Chip hue={kindHue(kind)} title={`${kind ?? "?"} · ${handleId(handle)}`}>
      {handleLabel(handle)}
    </Chip>
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

function IssueLines({ issues }: { issues: unknown }) {
  const rows = asRecords(issues);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {rows.map((issue, i) => (
        <MonoNote key={i} hue={issue.severity === "Error" ? "clay" : "kiln"}>
          {text(issue.severity)} {text(issue.code)}: {text(issue.message)}
        </MonoNote>
      ))}
    </div>
  );
}

/* ── revit.context.summary — the orientation card ─────────────────────────── */

function ContextSummaryView({ data }: OpViewProps) {
  const res = asRecord(data);
  const documents = res && asRecord(res.documents);
  if (!res || !documents) return <EmptyState note="unrecognized response shape" />;

  const activeDoc = asRecord(documents.activeDocument);
  const activeView = asRecord(res.activeView);
  const selection = asRecord(res.selection) ?? {};
  const browser = asRecord(res.browser) ?? {};
  const visibleCategories = asRecords(res.visibleCategories);

  const selectedCount = asNumber(selection.selectedElementCount) ?? 0;
  const returnedCount = asNumber(selection.returnedElementCount) ?? 0;
  const sheetPlacements = activeView ? asRecords(activeView.sheetPlacements) : [];

  return (
    <div className="flex flex-col gap-5">
      {/* title bar: document + active view, like Revit's window chrome distilled */}
      <div
        className="min-w-0 px-3 py-2"
        style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className="min-w-0 truncate text-sm font-semibold"
            title={activeDoc ? text(activeDoc.title) : undefined}
          >
            {activeDoc ? text(activeDoc.title) : "no active document"}
          </span>
          {activeDoc && (
            <span className="tele-label text-muted-foreground">{docKind(activeDoc)}</span>
          )}
          {activeDoc?.isWorkshared === true && <Chip hue="slate">workshared</Chip>}
          {activeDoc?.isModelInCloud === true && <Chip hue="blue">cloud</Chip>}
          {activeDoc?.isReadOnly === true && <Chip hue="kiln">read-only</Chip>}
        </div>
        {activeView && (
          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Chip hue={activeView.isSheet === true ? "green" : "blue"}>
              {text(activeView.viewType)}
            </Chip>
            <span className="min-w-0 truncate text-xs">{text(activeView.title)}</span>
            <MonoNote>1:{text(activeView.scale)}</MonoNote>
            {asString(activeView.levelName) && <MonoNote>{text(activeView.levelName)}</MonoNote>}
            {asString(activeView.viewTemplateName) && (
              <Chip hue="lichen" title="view template">
                {text(activeView.viewTemplateName)}
              </Chip>
            )}
            {sheetPlacements.map((p, i) => (
              <MonoNote key={i} hue={p.isActiveSheet === true ? "green" : undefined}>
                on {text(p.sheetNumber)} {text(p.sheetName)}
              </MonoNote>
            ))}
          </div>
        )}
      </div>

      {/* status bar: selection + project browser counts */}
      <OpSection label="session">
        <KVGrid
          columns={3}
          items={[
            {
              label: "selection",
              value: `${selectedCount} selected`,
              hue: selectedCount > 0 ? "blue" : undefined,
            },
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
      </OpSection>

      <OpSection
        label="visible categories"
        aside={<MonoNote>{visibleCategories.length} categories</MonoNote>}
      >
        {visibleCategories.length === 0 ? (
          <EmptyState note="no visible categories reported" />
        ) : (
          <div className="flex flex-wrap gap-1">
            {visibleCategories.map((cat, i) => {
              const handle = asRecord(cat.handle);
              return (
                <Chip key={i} hue="lichen" title={handle ? handleId(handle) : undefined}>
                  {handle ? handleLabel(handle) : "?"} {text(cat.elementCount)}
                </Chip>
              );
            })}
          </div>
        )}
        <Provenance>
          scope: active view · counts are observed at call time, not proven complete
        </Provenance>
      </OpSection>
    </div>
  );
}

/* ── revit.context.document-session — the document tab row ────────────────── */

function DocumentTab({ doc }: { doc: Record<string, unknown> }) {
  const isActive = doc.isActive === true;
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1.5"
      style={{
        border: `0.5px solid ${isActive ? "var(--line-2)" : "var(--line)"}`,
        borderRadius: 2,
        boxShadow: isActive ? "inset 0 2px 0 0 var(--pe-blue)" : undefined,
        background: isActive ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)" : undefined,
        maxWidth: "18rem",
      }}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={`min-w-0 truncate text-xs ${isActive ? "font-semibold" : ""}`}
          title={text(doc.title)}
        >
          {text(doc.title)}
        </span>
        <span className="tele-label shrink-0 text-muted-foreground">{docKind(doc)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {isActive && <Chip hue="blue">active</Chip>}
        {doc.isWorkshared === true && <Chip hue="slate">workshared</Chip>}
        {doc.isModelInCloud === true && <Chip hue="blue">cloud</Chip>}
        {doc.isReadOnly === true && <Chip hue="kiln">read-only</Chip>}
        {doc.isModifiable === false && doc.isReadOnly !== true && (
          <Chip hue="kiln">not modifiable</Chip>
        )}
      </div>
    </div>
  );
}

function DocumentSessionView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.openDocuments)) {
    return <EmptyState note="unrecognized response shape" />;
  }
  const docs = asRecords(res.openDocuments);

  return (
    <div className="flex flex-col gap-3">
      <OpSection
        label="open documents"
        aside={<MonoNote>{text(res.openDocumentCount)} open</MonoNote>}
      >
        {docs.length === 0 ? (
          <EmptyState note="no documents open" />
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
      </OpSection>
    </div>
  );
}

/* ── revit.context.visible-summary — visible elements by category ─────────── */

type VisibleCategoryRow = Record<string, unknown>;

function VisibleSummaryView({ data, request }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.categories)) {
    return <EmptyState note="unrecognized response shape" />;
  }
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
        if (samples.length === 0) return <MonoNote>∅</MonoNote>;
        const ids = samples.map((h) => handleId(h ?? undefined));
        const complete = row.isReturnedElementSetComplete === true;
        return (
          <MonoNote hue={complete ? undefined : "kiln"}>
            {ids.join(" ")}
            {!complete && " …"}
          </MonoNote>
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
        rowKey={(row, i) => {
          const handle = asRecord(row.handle);
          return handle ? `${handleId(handle)}-${handleLabel(handle)}` : String(i);
        }}
        footer={
          <MonoNote>
            {text(res.totalVisibleElementCount)} visible elements · {categories.length} categories
          </MonoNote>
        }
      />
      {views.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {views.map((view, i) => {
            const handle = asRecord(view.handle);
            return (
              <Chip key={i} hue="blue" title={handle ? handleId(handle) : undefined}>
                {text(view.title)} {text(view.elementCount)}
              </Chip>
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

  const stateItems = [
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
      hue: view.temporaryHideIsolateActive === true ? ("kiln" as CatHue) : undefined,
    },
  ];

  return (
    <div
      className="flex min-w-0 flex-col gap-4 px-3 py-2.5"
      style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <Chip hue="blue">{text(view.viewType)}</Chip>
        <span className="min-w-0 truncate text-xs font-semibold" title={text(view.title)}>
          {text(view.title)}
        </span>
        {asString(view.viewTemplateName) && (
          <Chip hue="lichen" title="view template">
            {text(view.viewTemplateName)}
          </Chip>
        )}
        {view.areGraphicsOverridesAllowed === false && <Chip hue="kiln">overrides disallowed</Chip>}
        <MonoNote>
          {text(view.candidateVisibleElementCount)} candidate visible ·{" "}
          {text(view.viewOwnedElementCount)} view-owned
        </MonoNote>
      </div>

      <OpSection label="graphics state">
        <KVGrid columns={3} items={stateItems} />
      </OpSection>

      {planViewRange && (
        <OpSection label="view range">
          <KVGrid columns={2} items={viewRangeItems(planViewRange)} />
        </OpSection>
      )}

      {view3D && (
        <OpSection label="3d state">
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
        </OpSection>
      )}

      <OpSection label="filters" aside={<MonoNote>{filters.length}</MonoNote>}>
        {filters.length === 0 ? (
          <MonoNote>no view filters applied</MonoNote>
        ) : (
          <div className="flex flex-wrap gap-1">
            {filters.map((filter, i) => {
              const fh = asRecord(filter.handle);
              const visible = filter.isVisible;
              return (
                <Chip
                  key={i}
                  hue={visible === false ? "clay" : "green"}
                  title={`${text(filter.elementFilterType) || "filter"} · ${asNumber(filter.categoryCount) ?? "?"} categories`}
                >
                  {fh ? handleLabel(fh) : "?"}{" "}
                  {visible == null ? "?" : visible ? "shown" : "hidden"}
                </Chip>
              );
            })}
          </div>
        )}
      </OpSection>

      <OpSection label="hidden categories" aside={<MonoNote>{hiddenCategories.length}</MonoNote>}>
        {hiddenCategories.length === 0 ? (
          <MonoNote>none hidden</MonoNote>
        ) : (
          <div className="flex flex-wrap gap-1">
            {hiddenCategories.map((cat, i) => {
              const ch = asRecord(cat.handle);
              return (
                <Chip key={i} hue="clay" title={text(cat.categoryType) || undefined}>
                  {ch ? handleLabel(ch) : "?"}
                </Chip>
              );
            })}
          </div>
        )}
      </OpSection>

      {links.length > 0 && (
        <OpSection label="links" aside={<MonoNote>{links.length}</MonoNote>}>
          <div className="flex flex-wrap gap-1">
            {links.map((link, i) => {
              const lh = asRecord(link.handle);
              const hidden = link.isHiddenInView === true;
              const unloaded = link.isLoaded === false;
              return (
                <Chip
                  key={i}
                  hue={hidden || unloaded ? "clay" : "slate"}
                  title={text(link.linkVisibilityType) || undefined}
                >
                  {lh ? handleLabel(lh) : "?"}
                  {hidden && " hidden"}
                  {unloaded && " unloaded"}
                </Chip>
              );
            })}
          </div>
        </OpSection>
      )}

      {worksets.length > 0 && (
        <OpSection label="worksets" aside={<MonoNote>{worksets.length}</MonoNote>}>
          <div className="flex flex-wrap gap-1">
            {worksets.map((workset, i) => (
              <Chip key={i} hue={text(workset.visibility) === "Hidden" ? "clay" : "slate"}>
                {text(workset.name)} {text(workset.visibility).toLowerCase()}
              </Chip>
            ))}
          </div>
        </OpSection>
      )}

      {provenance.length > 0 && <Provenance>{provenance.join(" · ")}</Provenance>}
    </div>
  );
}

function ViewRenderingStateView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.observedState)) {
    return <EmptyState note="unrecognized response shape" />;
  }
  const observed = asRecords(res.observedState);
  const notInspected = asArray(res.notInspected).map(text).filter(Boolean);
  const apiLimitations = asArray(res.apiLimitations).map(text).filter(Boolean);
  const confidenceWarnings = asArray(res.confidenceWarnings).map(text).filter(Boolean);
  const nextSteps = asArray(res.likelyInspectionNextSteps).map(text).filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {observed.length === 0 ? (
        <EmptyState note="no views observed" />
      ) : (
        observed.map((view, i) => {
          const handle = asRecord(view.handle);
          return <ObservedViewCard key={handle ? handleId(handle) : i} view={view} />;
        })
      )}

      {/* the honesty block: this op's whole point is explicit limitations */}
      <OpSection label="evidence limits">
        {confidenceWarnings.map((warning, i) => (
          <Provenance key={`w${i}`}>
            <MonoNote hue="kiln">confidence: {warning}</MonoNote>
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
      </OpSection>
      <IssueLines issues={res.issues} />
    </div>
  );
}

/* ── revit.resolve.references — resolution testimony ──────────────────────── */

function ResolveReferencesView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.candidates)) {
    return <EmptyState note="unrecognized response shape" />;
  }
  const candidates = asRecords(res.candidates);
  const candidateCount = asNumber(res.candidateCount) ?? candidates.length;
  const ambiguous = candidateCount > 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm">“{text(res.referenceText)}”</span>
        <MonoNote hue={ambiguous ? "kiln" : candidateCount === 1 ? "green" : "clay"}>
          {candidateCount === 0
            ? "no matches"
            : candidateCount === 1
              ? "resolved"
              : `${candidateCount} candidates — ambiguous`}
        </MonoNote>
      </div>

      {candidates.length === 0 ? (
        <EmptyState note="nothing in the model matched this reference" />
      ) : (
        <div className="flex flex-col">
          {candidates.map((candidate, i) => {
            const handle = asRecord(candidate.handle);
            const related = asRecords(candidate.relatedHandles);
            const provenance = provenanceDescriptions(candidate.provenance);
            const score = asNumber(candidate.score);
            return (
              <div
                key={handle ? `${handleId(handle)}-${i}` : i}
                className="flex min-w-0 flex-col gap-1 px-2.5 py-2"
                style={{
                  borderBottom: "0.5px solid var(--line-soft)",
                  borderLeft:
                    ambiguous && i > 0 ? "2px solid var(--cat-kiln)" : "2px solid transparent",
                }}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">→</span>
                  {handle && <HandleChip handle={handle} />}
                  <span className="min-w-0 truncate text-xs">{text(candidate.label)}</span>
                  {handle && <MonoNote>{handleId(handle)}</MonoNote>}
                  {score !== undefined && (
                    <MonoNote hue={ambiguous && i > 0 ? "kiln" : undefined}>score {score}</MonoNote>
                  )}
                </div>
                {related.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pl-5">
                    {related.map((rel, j) => (
                      <HandleChip key={j} handle={rel} />
                    ))}
                  </div>
                )}
                {provenance.length > 0 && (
                  <div className="pl-5">
                    <Provenance>{provenance.join(" · ")}</Provenance>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <IssueLines issues={res.issues} />
    </div>
  );
}

/* ── revit.context.view-image — the export result ─────────────────────────── */

function ViewImageView({ data }: OpViewProps) {
  const res = asRecord(data);
  const filePath = res && asString(res.filePath);
  if (!res || !filePath) return <EmptyState note="unrecognized response shape" />;

  const view = asRecord(res.view);
  const modelRect = asRecord(res.modelRect);
  const byteSize = asNumber(res.byteSize);
  const viewScale = asNumber(res.viewScale);
  const sheetNumber = asString(res.sheetNumber);

  const items: { label: string; value: ReactNode; hue?: CatHue }[] = [
    { label: "view", value: view ? handleLabel(view) : "∅", hue: "blue" },
    { label: "pixel size", value: `${text(res.pixelSize)} px (long edge)` },
    { label: "file size", value: byteSize !== undefined ? formatBytes(byteSize) : "∅" },
  ];
  if (viewScale !== undefined) items.push({ label: "view scale", value: `1:${viewScale}` });
  if (sheetNumber) items.push({ label: "sheet", value: sheetNumber, hue: "green" });

  return (
    <div className="flex flex-col gap-4">
      <OpSection label="exported image">
        <KVGrid columns={3} items={items} />
        <div className="mt-2">
          <div className="text-[11px] text-muted-foreground">file path</div>
          <div className="tele" title={filePath}>
            {truncateMiddle(filePath, 72)}
          </div>
        </div>
      </OpSection>

      {modelRect && (
        <OpSection label="model extent">
          <KVGrid
            columns={2}
            items={[
              { label: "min (x, y)", value: `${text(modelRect.minX)}, ${text(modelRect.minY)} ft` },
              { label: "max (x, y)", value: `${text(modelRect.maxX)}, ${text(modelRect.maxY)} ft` },
            ]}
          />
        </OpSection>
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
