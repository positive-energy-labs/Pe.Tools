import type { ReactNode } from "react";
import {
  type CatHue,
  Chip,
  type CoverageSegment,
  CoverageBar,
  EmptyState,
  KVGrid,
  MonoNote,
  OpSection,
  Provenance,
  catVar,
} from "#/ops/primitives";
import { asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/ops/synthetic";

/**
 * glance.* synthetic ops about the model itself: what IS this document, and
 * what is on the user's screen right now. Each view is a prototype of a
 * first-class contract — see contractNote per op.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

const HUE_CYCLE: CatHue[] = ["blue", "green", "slate", "lichen", "clay", "kiln"];

/** Discipline-flavored hue for a Revit category name; falls back to a cycle. */
function categoryHue(name: string, index: number): CatHue {
  const n = name.toLowerCase();
  if (/mechanical|duct|air|hvac|flex/.test(n)) return "green";
  if (/electrical|lighting|conduit|cable|wire|power|data|communication|fire|security|nurse|telephone|switch/.test(n))
    return "clay";
  if (/plumbing|pipe|sprinkler/.test(n)) return "blue";
  if (/annotation|tag|detail|title|text|symbol/.test(n)) return "slate";
  return HUE_CYCLE[index % HUE_CYCLE.length] ?? "lichen";
}

/** Group records by a name key, descending by count; top N + "other". */
function composition(
  rows: { name: string; count: number }[],
  topN: number,
): CoverageSegment[] {
  const byName = new Map<string, number>();
  for (const row of rows) byName.set(row.name, (byName.get(row.name) ?? 0) + row.count);
  const sorted = [...byName.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((acc, [, c]) => acc + c, 0);
  const segments: CoverageSegment[] = top.map(([label, count], i) => ({
    label,
    count,
    hue: categoryHue(label, i),
  }));
  if (rest > 0) segments.push({ label: `other ×${sorted.length - topN}`, count: rest, hue: "slate" });
  return segments;
}

function obs(observedAtMs: number): string {
  return observedAtMs ? new Date(observedAtMs).toLocaleTimeString() : "—";
}

/** Stat band cell: tele value over a quiet sans label. */
function Stat({ label, value, hue }: { label: string; value: ReactNode; hue?: CatHue }) {
  return (
    <div className="min-w-[64px] px-3 py-1.5" style={{ borderRight: "0.5px solid var(--line-soft)" }}>
      <div className="tele" style={hue ? { color: catVar(hue) } : undefined}>
        {value ?? "∅"}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

/* ── glance.model — what IS this model ────────────────────────────────────── */

const SERIES_META: Record<string, { label: string; hue: CatHue }> = {
  M: { label: "mechanical", hue: "green" },
  E: { label: "electrical", hue: "clay" },
  P: { label: "plumbing", hue: "blue" },
  G: { label: "general", hue: "slate" },
};

function ModelGlanceView({ results, observedAtMs }: SyntheticViewProps) {
  const ctx = asRecord(results["revit.context.summary"]);
  const documents = ctx ? asRecord(ctx.documents) : undefined;
  if (!ctx || !documents) return <EmptyState note="unrecognized revit.context.summary shape" />;

  const doc = asRecord(documents.activeDocument);
  const browser = asRecord(ctx.browser) ?? {};

  const index = asRecord(results["revit.catalog.project-index"]);
  const levels = index ? asRecords(index.levels) : [];
  const sheets = index ? asRecords(index.sheets) : [];
  const schedules = index ? asRecords(index.schedules) : [];

  const fams = asRecord(results["revit.catalog.loaded-families"]);
  const famSummary = fams ? asRecord(fams.summary) : undefined;
  const famPage = fams ? asRecord(fams.page) : undefined;
  const famRows = fams ? asRecords(fams.families) : [];

  const bindings = asRecord(results["revit.catalog.parameter-bindings"]);
  const bindingSummary = bindings ? asRecord(bindings.summary) : undefined;

  // discipline hints: sheet-number series (M/E/P/G…) — inferred, labeled as such.
  const seriesCounts = new Map<string, number>();
  for (const sheet of sheets) {
    const num = asString(sheet.sheetNumber) ?? "";
    const first = num.charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) seriesCounts.set(first, (seriesCounts.get(first) ?? 0) + 1);
  }
  const series = [...seriesCounts.entries()].sort((a, b) => b[1] - a[1]);

  const path = doc ? (asString(doc.path) ?? "") : "";
  const isTemplateFile = /\.rte$/i.test(path);

  const famComposition = composition(
    famRows.map((f) => ({ name: asString(f.categoryName) ?? "uncategorized", count: 1 })),
    7,
  );
  const famTotal = famPage ? asNumber(famPage.totalCount) : undefined;
  const famReturned = famPage ? asNumber(famPage.returnedCount) : undefined;

  const scheduleRowCounts = schedules.map((s) => asNumber(s.visibleBodyRowCount) ?? 0);
  const schedulesWithRows = scheduleRowCounts.filter((c) => c > 0).length;

  const instanceBindings = bindingSummary ? asNumber(bindingSummary.instanceBindings) : undefined;
  const typeBindings = bindingSummary ? asNumber(bindingSummary.typeBindings) : undefined;
  const totalBindings = bindingSummary ? asNumber(bindingSummary.totalBindings) : undefined;
  const bindingsByCategory = bindingSummary ? (asRecord(bindingSummary.bindingsByCategory) ?? {}) : {};
  const topBoundCategories = Object.entries(bindingsByCategory)
    .map(([name, count]) => ({ name, count: asNumber(count) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      {/* document hero: identity + discipline + levels, first 200px answers the question */}
      <div className="min-w-0 px-3 py-2" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={path || undefined}>
            {doc ? text(doc.title) : "no active document"}
          </span>
          {doc && (
            <span className="tele-label text-muted-foreground">
              {doc.isFamilyDocument === true ? "family" : isTemplateFile ? "project template" : "project"}
            </span>
          )}
          {doc?.isWorkshared === true && <Chip hue="slate">workshared</Chip>}
          {doc?.isModelInCloud === true && <Chip hue="blue">cloud</Chip>}
          {doc?.isReadOnly === true && <Chip hue="kiln">read-only</Chip>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {series.length === 0 ? (
            <MonoNote>no sheet series to infer discipline from</MonoNote>
          ) : (
            series.map(([letter, count]) => {
              const meta = SERIES_META[letter];
              return (
                <Chip key={letter} hue={meta?.hue ?? "lichen"} title={`${count} sheets numbered ${letter}…`}>
                  {letter} {meta ? `· ${meta.label}` : ""} {count}
                </Chip>
              );
            })
          )}
          <MonoNote>discipline inferred from sheet-number series</MonoNote>
        </div>
        {levels.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[11px] text-muted-foreground">{levels.length} levels</span>
            {levels.map((level, i) => (
              <MonoNote key={i}>
                {text(level.name)} @ {(asNumber(level.elevation) ?? 0).toFixed(1)}ft
              </MonoNote>
            ))}
          </div>
        )}
      </div>

      {/* stat band: browser + family totals */}
      <div className="flex flex-wrap" style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}>
        <Stat label="views" value={text(browser.viewCount)} />
        <Stat label="sheets" value={text(browser.sheetCount)} />
        <Stat label="schedules" value={text(browser.scheduleCount)} />
        <Stat label="families" value={famSummary ? text(famSummary.totalFamilies) : text(browser.familyCount)} />
        <Stat label="types" value={famSummary ? text(famSummary.totalTypes) : "∅"} />
        <Stat
          label="placed instances"
          value={famSummary ? text(famSummary.totalPlacedInstances) : "∅"}
          hue={famSummary && (asNumber(famSummary.totalPlacedInstances) ?? 0) === 0 ? "kiln" : undefined}
        />
        {famSummary && (
          <Stat
            label="unplaced families"
            value={text(famSummary.unplacedFamilies)}
            hue={(asNumber(famSummary.unplacedFamilies) ?? 0) > (asNumber(famSummary.placedFamilies) ?? 0) ? "kiln" : undefined}
          />
        )}
      </div>

      {/* shape-of-the-model findings */}
      {schedules.length > 0 && schedulesWithRows === 0 && (
        <MonoNote hue="kiln">
          all {schedules.length} indexed schedules report 0 visible body rows — an unpopulated template, not a data
          error
        </MonoNote>
      )}

      <OpSection
        label="family composition by category"
        aside={
          famTotal !== undefined && <MonoNote>{famReturned ?? famRows.length} of {famTotal} families</MonoNote>
        }
      >
        {famRows.length === 0 ? (
          <EmptyState note={fams ? "no families returned" : "revit.catalog.loaded-families unavailable — partial glance"} />
        ) : (
          <>
            <CoverageBar segments={famComposition} total={famReturned ?? famRows.length} />
            {famReturned !== undefined && famTotal !== undefined && famReturned < famTotal && (
              <Provenance>
                composition covers {famReturned} of {famTotal} families (budget truncation) · obs {obs(observedAtMs)}
              </Provenance>
            )}
          </>
        )}
      </OpSection>

      <OpSection
        label="parameter binding health"
        aside={totalBindings !== undefined && <MonoNote>{totalBindings} project bindings</MonoNote>}
      >
        {!bindingSummary ? (
          <EmptyState note="revit.catalog.parameter-bindings unavailable — partial glance" />
        ) : (
          <div className="flex flex-col gap-2">
            <CoverageBar
              segments={[
                { label: "instance", count: instanceBindings ?? 0, hue: "blue" },
                { label: "type", count: typeBindings ?? 0, hue: "slate" },
              ]}
              total={totalBindings}
            />
            {topBoundCategories.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {topBoundCategories.map((cat, i) => (
                  <Chip key={cat.name} hue={categoryHue(cat.name, i)} title={`${cat.count} bindings`}>
                    {cat.name} {cat.count}
                  </Chip>
                ))}
                <MonoNote>most-bound categories</MonoNote>
              </div>
            )}
            {bindingSummary.truncated === true && (
              <Provenance>binding entries truncated by budget; summary counts are complete · obs {obs(observedAtMs)}</Provenance>
            )}
          </div>
        )}
      </OpSection>

      <Provenance>
        browser counts from revit.context.summary; levels/sheets/schedules from project-index (budget 150 entries);
        family + binding totals from catalog summaries · obs {obs(observedAtMs)}
      </Provenance>
    </div>
  );
}

/* ── glance.attention — what the user sees ────────────────────────────────── */

function AttentionGlanceView({ results, observedAtMs }: SyntheticViewProps) {
  const ctx = asRecord(results["revit.context.summary"]);
  if (!ctx) return <EmptyState note="unrecognized revit.context.summary shape" />;

  const activeView = asRecord(ctx.activeView);
  const sheetPlacements = activeView ? asRecords(activeView.sheetPlacements) : [];

  const visible = asRecord(results["revit.context.visible-summary"]);
  const visibleCategories = visible ? asRecords(visible.categories) : [];
  const totalVisible = visible ? asNumber(visible.totalVisibleElementCount) : undefined;
  const visibleIssues = visible ? asRecords(visible.issues) : [];

  const rendering = asRecord(results["revit.context.view-rendering-state"]);
  const observedState = rendering ? asRecords(rendering.observedState) : [];
  const viewState = observedState[0];
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
  const confidenceWarnings = strings(rendering?.confidenceWarnings);
  const apiLimitations = strings(rendering?.apiLimitations);
  const notInspected = strings(rendering?.notInspected);

  const visibleComposition = composition(
    visibleCategories.map((cat) => {
      const handle = asRecord(cat.handle);
      return {
        name: (handle && asString(handle.label)) ?? "unknown category",
        count: asNumber(cat.elementCount) ?? 0,
      };
    }),
    8,
  );

  const limitAdjusted = visibleIssues.filter(
    (issue) => asString(issue.code) === "AgentContextRequestLimitAdjusted",
  );

  return (
    <div className="flex flex-col gap-5">
      {/* active-view stage card */}
      {!activeView ? (
        <EmptyState note="no active view reported" />
      ) : (
        <div className="min-w-0 px-3 py-2" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <Chip hue={activeView.isSheet === true ? "green" : "blue"}>{text(activeView.viewType)}</Chip>
            {activeView.isTemplate === true && <Chip hue="kiln">view template</Chip>}
            <MonoNote>1:{text(activeView.scale)}</MonoNote>
            {sheetPlacements.map((p, i) => (
              <MonoNote key={i} hue={p.isActiveSheet === true ? "green" : undefined}>
                sheet {text(p.sheetNumber)} · {text(p.sheetName)}
              </MonoNote>
            ))}
          </div>
          {viewState && (
            <div className="mt-2">
              <KVGrid
                columns={3}
                items={[
                  { label: "display style", value: text(viewState.displayStyle) },
                  { label: "detail level", value: text(viewState.detailLevel) },
                  { label: "candidate visible elements", value: text(viewState.candidateVisibleElementCount) },
                  { label: "view-owned elements", value: text(viewState.viewOwnedElementCount) },
                  {
                    label: "temporary hide/isolate",
                    value: viewState.temporaryHideIsolateActive === true ? "ACTIVE" : "off",
                    hue: viewState.temporaryHideIsolateActive === true ? "kiln" : undefined,
                  },
                  {
                    label: "crop box",
                    value: viewState.cropBoxActive === true ? "active" : "off",
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <OpSection
        label="visible elements by category"
        aside={totalVisible !== undefined && <MonoNote>{totalVisible} visible elements</MonoNote>}
      >
        {!visible ? (
          <EmptyState note="revit.context.visible-summary unavailable — trust the stage card only" />
        ) : visibleComposition.length === 0 ? (
          <EmptyState note="0 visible elements reported in the active view" />
        ) : (
          <>
            <CoverageBar segments={visibleComposition} total={totalVisible} />
            <Provenance>
              bounded fetch: maxCategories 24 requested
              {limitAdjusted.length > 0 &&
                ` · host adjusted limits: ${limitAdjusted.map((i) => text(i.message)).join(" / ")}`}{" "}
              · obs {obs(observedAtMs)}
            </Provenance>
          </>
        )}
      </OpSection>

      <OpSection label="can pea trust this view?">
        {!rendering ? (
          <EmptyState note="revit.context.view-rendering-state unavailable — no trust evidence" />
        ) : (
          <div className="flex flex-col gap-2">
            {confidenceWarnings.length === 0 ? (
              <MonoNote>0 confidence warnings from the rendering-state probe</MonoNote>
            ) : (
              <ul className="flex flex-col gap-1">
                {confidenceWarnings.map((warning, i) => (
                  <li key={i} className="tele text-[10px]" style={{ color: catVar("kiln") }}>
                    {warning}
                  </li>
                ))}
              </ul>
            )}
            {apiLimitations.length > 0 && (
              <div
                className="px-2 py-1.5"
                style={{
                  borderRadius: 2,
                  background: `color-mix(in srgb, ${catVar("kiln")} 6%, transparent)`,
                  border: `0.5px solid color-mix(in srgb, ${catVar("kiln")} 25%, transparent)`,
                }}
              >
                <div className="tele-label mb-1" style={{ color: catVar("kiln") }}>
                  api limitations (verbatim)
                </div>
                <ul className="flex flex-col gap-1">
                  {apiLimitations.map((limitation, i) => (
                    <li key={i} className="text-[11px] leading-snug" style={{ color: catVar("kiln") }}>
                      {limitation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {notInspected.length > 0 && (
              <details>
                <summary className="tele cursor-pointer select-none text-[10px] text-muted-foreground">
                  {notInspected.length} things this packet did NOT inspect
                </summary>
                <ul className="mt-1 flex flex-col gap-1 pl-3">
                  {notInspected.map((item, i) => (
                    <li key={i} className="text-[11px] leading-snug text-muted-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </OpSection>

      <Provenance>
        stage from revit.context.summary; composition from visible-summary; trust strip quotes
        view-rendering-state verbatim · obs {obs(observedAtMs)}
      </Provenance>
    </div>
  );
}

/* ── registration ─────────────────────────────────────────────────────────── */

export const modelGlanceOps: SyntheticOp[] = [
  {
    key: "glance.model",
    displayName: "Model at a glance",
    blurb: "What IS this model — how big, what discipline, what shape is it in?",
    contractNote:
      "Prototypes a revit.glance.model op: doc identity + true project totals + family/category composition + binding health in one bounded response (today: 4 calls, 3 different truncation dialects).",
    deps: [
      { key: "revit.context.summary" },
      {
        key: "revit.catalog.project-index",
        request: { sections: ["Levels", "Sheets", "Schedules"], budget: { maxEntries: 150 } },
        optional: true,
      },
      {
        key: "revit.catalog.loaded-families",
        request: { budget: { maxEntries: 600 } },
        optional: true,
      },
      { key: "revit.catalog.parameter-bindings", optional: true },
    ],
    View: ModelGlanceView,
  },
  {
    key: "glance.attention",
    displayName: "What the user sees",
    blurb: "What is on the user's screen right now, and can pea trust it?",
    contractNote:
      "Prototypes a revit.glance.attention op: active-view identity + visible composition + trust caveats in one packet (today visible-summary defaults maxCategories to the MINIMUM, silently under-reporting).",
    deps: [
      { key: "revit.context.summary" },
      {
        key: "revit.context.visible-summary",
        request: { maxCategories: 24 },
        optional: true,
      },
      { key: "revit.context.view-rendering-state", optional: true },
    ],
    View: AttentionGlanceView,
  },
];
