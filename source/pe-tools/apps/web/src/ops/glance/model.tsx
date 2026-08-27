import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { CoverageBar, type CoverageSegment } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, VizChip, type VizIndex } from "#/ops/primitives";
import { UnrecognizedShape, asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/ops/synthetic";

/**
 * glance.* surfaces about the model itself: what IS this document, and what is
 * on the user's screen right now. Backed by the first-class revit.glance.* ops
 * (ADR 0003) — one bounded packet each, observedAtUtc stamped host-side.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

const VIZ_CYCLE: VizIndex[] = [1, 2, 3, 4, 5, 6];

/** Discipline-flavored viz rung for a Revit category name; falls back to a cycle.
 * Taxonomy only — the rung asserts identity, never state. */
function categoryViz(name: string, index: number): VizIndex {
  const n = name.toLowerCase();
  if (/mechanical|duct|air|hvac|flex/.test(n)) return 2;
  if (
    /electrical|lighting|conduit|cable|wire|power|data|communication|fire|security|nurse|telephone|switch/.test(
      n,
    )
  )
    return 5;
  if (/plumbing|pipe|sprinkler/.test(n)) return 1;
  if (/annotation|tag|detail|title|text|symbol/.test(n)) return 3;
  return VIZ_CYCLE[index % VIZ_CYCLE.length] ?? 4;
}

/** Sort name/count rows descending; top N + "other". */
function composition(rows: { name: string; count: number }[], topN: number): CoverageSegment[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((acc, row) => acc + row.count, 0);
  const segments: CoverageSegment[] = top.map((row, i) => ({
    label: row.name,
    count: row.count,
    viz: categoryViz(row.name, i),
  }));
  if (rest > 0) segments.push({ label: `other ×${sorted.length - topN}`, count: rest, viz: 3 });
  return segments;
}

/** Freshness stamp: prefer the op's host-side observedAtUtc over client receive time. */
function obs(observedAtUtc: string | undefined, fallbackMs: number): string {
  if (observedAtUtc) return new Date(observedAtUtc).toLocaleTimeString();
  return fallbackMs ? new Date(fallbackMs).toLocaleTimeString() : "—";
}

function MonoAside({ children }: { children: ReactNode }) {
  return <span className="face-mono t-caption text-ink-2">{children}</span>;
}

/** Stat band cell: mono value over a quiet sans label. `warn` is the only state a
 * stat may carry — caution ink, the label saying why in the title. */
function Stat({
  label,
  value,
  warn,
  warnTitle,
}: {
  label: string;
  value: ReactNode;
  warn?: boolean;
  warnTitle?: string;
}) {
  return (
    <div
      className="min-w-[64px] border-r border-line px-3 py-1.5"
      title={warn ? warnTitle : undefined}
    >
      <div className="face-mono t-value" style={warn ? { color: "var(--pe-caution)" } : undefined}>
        {value ?? "∅"}
      </div>
      <div className="t-caption text-ink-2">{label}</div>
    </div>
  );
}

/* ── glance.model — what IS this model ────────────────────────────────────── */

/** Sheet-series prefix is discipline taxonomy — viz by kind, label carries the word. */
const SERIES_META: Record<string, { label: string; viz: VizIndex }> = {
  M: { label: "mechanical", viz: 2 },
  E: { label: "electrical", viz: 5 },
  P: { label: "plumbing", viz: 1 },
  G: { label: "general", viz: 3 },
};

function ModelGlanceView({ results, observedAtMs }: SyntheticViewProps) {
  const res = asRecord(results["revit.glance.model"]);
  if (!res) return <UnrecognizedShape />;

  const observedAtUtc = asString(res.observedAtUtc);
  const doc = asRecord(res.document);
  const totals = asRecord(res.projectTotals) ?? {};
  const levels = asRecords(res.levels);
  const series = asRecords(res.sheetNumberSeries).sort(
    (a, b) => (asNumber(b.sheetCount) ?? 0) - (asNumber(a.sheetCount) ?? 0),
  );
  const famSummary = asRecord(res.families);
  const famByCategory = asRecords(res.familiesByCategory);
  const bindingSummary = asRecord(res.bindings);

  const path = doc ? (asString(doc.path) ?? "") : "";
  const isTemplateFile = /\.rte$/i.test(path);

  const famComposition = composition(
    famByCategory.map((cat) => ({
      name: asString(cat.categoryName) ?? "uncategorized",
      count: asNumber(cat.familyCount) ?? 0,
    })),
    7,
  );
  const famTotal = famSummary ? asNumber(famSummary.totalFamilies) : undefined;

  const instanceBindings = bindingSummary ? asNumber(bindingSummary.instanceBindings) : undefined;
  const typeBindings = bindingSummary ? asNumber(bindingSummary.typeBindings) : undefined;
  const totalBindings = bindingSummary ? asNumber(bindingSummary.totalBindings) : undefined;
  const bindingsByCategory = bindingSummary
    ? (asRecord(bindingSummary.bindingsByCategory) ?? {})
    : {};
  const topBoundCategories = Object.entries(bindingsByCategory)
    .map(([name, count]) => ({ name, count: asNumber(count) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      {/* document hero: identity + discipline + levels, first 200px answers the question */}
      <div className="min-w-0 rounded-md border border-line-2 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="t-value min-w-0 truncate font-medium" title={path || undefined}>
            {doc ? text(doc.title) : "no active document"}
          </span>
          {doc && (
            <span className="face-mono t-caption text-ink-2">
              {doc.isFamilyDocument === true
                ? "family"
                : isTemplateFile
                  ? "project template"
                  : "project"}
            </span>
          )}
          {doc?.isWorkshared === true && (
            <FactChip title="worksharing is enabled">workshared</FactChip>
          )}
          {doc?.isModelInCloud === true && (
            <FactChip title="this model lives in the cloud">cloud</FactChip>
          )}
          {doc?.isReadOnly === true && (
            <FactChip tone="caution" title="document is read-only — no write can land">
              read-only
            </FactChip>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {series.length === 0 ? (
            <MonoAside>no sheet series to infer discipline from</MonoAside>
          ) : (
            series.map((entry) => {
              const letter = asString(entry.prefix) ?? "?";
              const count = asNumber(entry.sheetCount) ?? 0;
              const meta = SERIES_META[letter];
              return (
                <VizChip
                  key={letter}
                  viz={meta?.viz ?? 4}
                  title={`${count} sheets numbered ${letter}…`}
                >
                  {letter} {meta ? `· ${meta.label}` : ""} {count}
                </VizChip>
              );
            })
          )}
          <MonoAside>discipline inferred from sheet-number series</MonoAside>
        </div>
        {levels.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="t-label text-ink-2">{levels.length} levels</span>
            {levels.map((level, i) => (
              <MonoAside key={i}>
                {text(level.name)} @ {(asNumber(level.elevationFeet) ?? 0).toFixed(1)}ft
              </MonoAside>
            ))}
          </div>
        )}
      </div>

      {/* stat band: true project totals + family totals */}
      <div className="flex flex-wrap rounded-md border border-line">
        <Stat label="views" value={text(totals.viewCount)} />
        <Stat label="sheets" value={text(totals.sheetCount)} />
        <Stat label="schedules" value={text(totals.scheduleCount)} />
        <Stat
          label="families"
          value={famSummary ? text(famSummary.totalFamilies) : text(totals.familyCount)}
        />
        <Stat label="types" value={famSummary ? text(famSummary.totalTypes) : "∅"} />
        <Stat
          label="placed instances"
          value={famSummary ? text(famSummary.totalPlacedInstances) : "∅"}
          warn={famSummary != null && (asNumber(famSummary.totalPlacedInstances) ?? 0) === 0}
          warnTitle="zero placed instances — the model may be a shell"
        />
        {famSummary && (
          <Stat
            label="unplaced families"
            value={text(famSummary.unplacedFamilies)}
            warn={
              (asNumber(famSummary.unplacedFamilies) ?? 0) >
              (asNumber(famSummary.placedFamilies) ?? 0)
            }
            warnTitle="more unplaced than placed families"
          />
        )}
      </div>

      <Section
        label="family composition by category"
        aside={famTotal !== undefined && <MonoAside>{famTotal} families</MonoAside>}
      >
        {famComposition.length === 0 || (famTotal ?? 1) <= 0 ? (
          <EmptyState story="scope" exit="load families into the document first">
            no loaded families reported
          </EmptyState>
        ) : (
          <>
            <CoverageBar segments={famComposition} total={famTotal} />
            {famSummary?.truncated === true && (
              <Provenance>
                family summary flagged truncated by the host · obs{" "}
                {obs(observedAtUtc, observedAtMs)}
              </Provenance>
            )}
          </>
        )}
      </Section>

      <Section
        label="parameter binding health"
        aside={
          totalBindings !== undefined && <MonoAside>{totalBindings} project bindings</MonoAside>
        }
      >
        {!bindingSummary || (totalBindings ?? 0) <= 0 ? (
          <EmptyState story="scope" exit="bind project parameters to categories first">
            no project parameter bindings reported
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            <CoverageBar
              segments={[
                { label: "instance", count: instanceBindings ?? 0, viz: 1 },
                { label: "type", count: typeBindings ?? 0, viz: 3 },
              ]}
              total={totalBindings}
            />
            {topBoundCategories.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {topBoundCategories.map((cat, i) => (
                  <VizChip
                    key={cat.name}
                    viz={categoryViz(cat.name, i)}
                    title={`${cat.count} bindings`}
                  >
                    {cat.name} {cat.count}
                  </VizChip>
                ))}
                <MonoAside>most-bound categories</MonoAside>
              </div>
            )}
            {bindingSummary.truncated === true && (
              <Provenance>
                binding entries truncated by budget; summary counts are complete · obs{" "}
                {obs(observedAtUtc, observedAtMs)}
              </Provenance>
            )}
          </div>
        )}
      </Section>

      <Provenance>
        one bounded revit.glance.model packet; summaries are complete, never truncated · obs{" "}
        {obs(observedAtUtc, observedAtMs)} (host clock)
      </Provenance>
    </div>
  );
}

/* ── glance.attention — what the user sees ────────────────────────────────── */

function AttentionGlanceView({ results, observedAtMs }: SyntheticViewProps) {
  const res = asRecord(results["revit.glance.attention"]);
  if (!res) return <UnrecognizedShape />;

  const observedAtUtc = asString(res.observedAtUtc);
  const activeView = asRecord(res.activeView);
  const sheetPlacements = activeView ? asRecords(activeView.sheetPlacements) : [];
  const viewState = asRecord(res.viewState);
  const visibleCategories = asRecords(res.visibleCategories);
  const totalVisible = asNumber(res.totalVisibleElementCount);
  const issues = asRecords(res.issues);
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
  const confidenceWarnings = strings(res.confidenceWarnings);
  const apiLimitations = strings(res.apiLimitations);
  const notInspected = strings(res.notInspected);

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

  const limitAdjusted = issues.filter(
    (issue) => asString(issue.code) === "AgentContextRequestLimitAdjusted",
  );

  return (
    <div className="flex flex-col gap-5">
      {/* active-view stage card */}
      {!activeView ? (
        <EmptyState story="scope" exit="open a view in the connected Revit session">
          no active view reported
        </EmptyState>
      ) : (
        <div className="min-w-0 rounded-md border border-line-2 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="t-value min-w-0 truncate font-medium" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <VizChip viz={activeView.isSheet === true ? 2 : 1} title="view kind">
              {text(activeView.viewType)}
            </VizChip>
            {activeView.isTemplate === true && (
              <FactChip
                tone="caution"
                title="this is a view template, not a model view — trust nothing spatial"
              >
                view template
              </FactChip>
            )}
            <MonoAside>1:{text(activeView.scale)}</MonoAside>
            {sheetPlacements.map((p, i) => (
              <span
                key={i}
                className="face-mono t-caption"
                style={{
                  color: p.isActiveSheet === true ? "var(--pe-ink)" : "var(--pe-ink-2)",
                }}
                title={p.isActiveSheet === true ? "this is the active sheet" : undefined}
              >
                sheet {text(p.sheetNumber)} · {text(p.sheetName)}
              </span>
            ))}
          </div>
          {viewState && (
            <div className="mt-2">
              <KVGrid
                columns={3}
                items={[
                  { label: "display style", value: text(viewState.displayStyle) },
                  { label: "detail level", value: text(viewState.detailLevel) },
                  {
                    label: "candidate visible elements",
                    value: text(viewState.candidateVisibleElementCount),
                  },
                  { label: "view-owned elements", value: text(viewState.viewOwnedElementCount) },
                  {
                    label: "temporary hide/isolate",
                    value: viewState.temporaryHideIsolateActive === true ? "ACTIVE" : "off",
                    tone: viewState.temporaryHideIsolateActive === true ? "caution" : undefined,
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

      <Section
        label="visible elements by category"
        aside={totalVisible !== undefined && <MonoAside>{totalVisible} visible elements</MonoAside>}
      >
        {visibleComposition.length === 0 || (totalVisible ?? 1) <= 0 ? (
          <EmptyState story="scope" exit="unhide something, or open a view that shows the model">
            0 visible elements reported in the active view
          </EmptyState>
        ) : (
          <>
            <CoverageBar segments={visibleComposition} total={totalVisible} />
            {limitAdjusted.length > 0 && (
              <Provenance>
                host adjusted limits: {limitAdjusted.map((i) => text(i.message)).join(" / ")} · obs{" "}
                {obs(observedAtUtc, observedAtMs)}
              </Provenance>
            )}
          </>
        )}
      </Section>

      <Section label="can pea trust this view?">
        <div className="flex flex-col gap-2">
          {confidenceWarnings.length === 0 ? (
            <MonoAside>0 confidence warnings from the rendering-state probe</MonoAside>
          ) : (
            <ul className="flex flex-col gap-1">
              {confidenceWarnings.map((warning, i) => (
                <li key={i} className="face-mono t-caption" style={{ color: "var(--pe-caution)" }}>
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {apiLimitations.length > 0 && (
            /* plain content, not enclosed (border budget) — the caution ink and the
               upper head carry the weight the old tinted box was buying. */
            <div>
              <div
                className="face-mono t-caption t-upper mb-1"
                style={{ color: "var(--pe-caution)" }}
              >
                api limitations (verbatim)
              </div>
              <ul className="flex flex-col gap-1">
                {apiLimitations.map((limitation, i) => (
                  <li
                    key={i}
                    className="t-label leading-snug"
                    style={{ color: "var(--pe-caution)" }}
                  >
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notInspected.length > 0 && (
            <details>
              <summary className="face-mono t-caption cursor-pointer select-none text-ink-2">
                {notInspected.length} things this packet did NOT inspect
              </summary>
              <ul className="mt-1 flex flex-col gap-1 pl-3">
                {notInspected.map((item, i) => (
                  <li key={i} className="t-label leading-snug text-ink-2">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Section>

      <Provenance>
        one bounded revit.glance.attention packet; trust strip quoted verbatim · obs{" "}
        {obs(observedAtUtc, observedAtMs)} (host clock)
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
      "First-class since ADR 0003: one revit.glance.model packet replaced the 4-call client fan-out (3 truncation dialects).",
    deps: [{ key: "revit.glance.model" }],
    View: ModelGlanceView,
  },
  {
    key: "glance.attention",
    displayName: "What the user sees",
    blurb: "What is on the user's screen right now, and can pea trust it?",
    contractNote:
      "First-class since ADR 0003: one revit.glance.attention packet replaced the 3-call fan-out; limits are host-owned and never clamp to the minimum.",
    deps: [{ key: "revit.glance.attention" }],
    View: AttentionGlanceView,
  },
];
