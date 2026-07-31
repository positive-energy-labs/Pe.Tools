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
 * glance.* surfaces about the model itself: what IS this document, and what is
 * on the user's screen right now. Backed by the first-class revit.glance.* ops
 * (ADR 0003) — one bounded packet each, observedAtUtc stamped host-side.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

const HUE_CYCLE: CatHue[] = ["blue", "green", "slate", "lichen", "clay", "kiln"];

/** Discipline-flavored hue for a Revit category name; falls back to a cycle. */
function categoryHue(name: string, index: number): CatHue {
  const n = name.toLowerCase();
  if (/mechanical|duct|air|hvac|flex/.test(n)) return "green";
  if (
    /electrical|lighting|conduit|cable|wire|power|data|communication|fire|security|nurse|telephone|switch/.test(
      n,
    )
  )
    return "clay";
  if (/plumbing|pipe|sprinkler/.test(n)) return "blue";
  if (/annotation|tag|detail|title|text|symbol/.test(n)) return "slate";
  return HUE_CYCLE[index % HUE_CYCLE.length] ?? "lichen";
}

/** Sort name/count rows descending; top N + "other". */
function composition(rows: { name: string; count: number }[], topN: number): CoverageSegment[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((acc, row) => acc + row.count, 0);
  const segments: CoverageSegment[] = top.map((row, i) => ({
    label: row.name,
    count: row.count,
    hue: categoryHue(row.name, i),
  }));
  if (rest > 0)
    segments.push({ label: `other ×${sorted.length - topN}`, count: rest, hue: "slate" });
  return segments;
}

/** Freshness stamp: prefer the op's host-side observedAtUtc over client receive time. */
function obs(observedAtUtc: string | undefined, fallbackMs: number): string {
  if (observedAtUtc) return new Date(observedAtUtc).toLocaleTimeString();
  return fallbackMs ? new Date(fallbackMs).toLocaleTimeString() : "—";
}

/** Stat band cell: tele value over a quiet sans label. */
function Stat({ label, value, hue }: { label: string; value: ReactNode; hue?: CatHue }) {
  return (
    <div
      className="min-w-[64px] px-3 py-1.5"
      style={{ borderRight: "0.5px solid var(--line-soft)" }}
    >
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
  const res = asRecord(results["revit.glance.model"]);
  if (!res) return <EmptyState note="unrecognized revit.glance.model shape" />;

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
      <div
        className="min-w-0 px-3 py-2"
        style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={path || undefined}>
            {doc ? text(doc.title) : "no active document"}
          </span>
          {doc && (
            <span className="tele-label text-muted-foreground">
              {doc.isFamilyDocument === true
                ? "family"
                : isTemplateFile
                  ? "project template"
                  : "project"}
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
            series.map((entry) => {
              const letter = asString(entry.prefix) ?? "?";
              const count = asNumber(entry.sheetCount) ?? 0;
              const meta = SERIES_META[letter];
              return (
                <Chip
                  key={letter}
                  hue={meta?.hue ?? "lichen"}
                  title={`${count} sheets numbered ${letter}…`}
                >
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
                {text(level.name)} @ {(asNumber(level.elevationFeet) ?? 0).toFixed(1)}ft
              </MonoNote>
            ))}
          </div>
        )}
      </div>

      {/* stat band: true project totals + family totals */}
      <div
        className="flex flex-wrap"
        style={{ border: "0.5px solid var(--line)", borderRadius: 2 }}
      >
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
          hue={
            famSummary && (asNumber(famSummary.totalPlacedInstances) ?? 0) === 0
              ? "kiln"
              : undefined
          }
        />
        {famSummary && (
          <Stat
            label="unplaced families"
            value={text(famSummary.unplacedFamilies)}
            hue={
              (asNumber(famSummary.unplacedFamilies) ?? 0) >
              (asNumber(famSummary.placedFamilies) ?? 0)
                ? "kiln"
                : undefined
            }
          />
        )}
      </div>

      <OpSection
        label="family composition by category"
        aside={famTotal !== undefined && <MonoNote>{famTotal} families</MonoNote>}
      >
        {famComposition.length === 0 ? (
          <EmptyState note="no loaded families reported" />
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
      </OpSection>

      <OpSection
        label="parameter binding health"
        aside={totalBindings !== undefined && <MonoNote>{totalBindings} project bindings</MonoNote>}
      >
        {!bindingSummary ? (
          <EmptyState note="no binding summary in the glance packet" />
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
                  <Chip
                    key={cat.name}
                    hue={categoryHue(cat.name, i)}
                    title={`${cat.count} bindings`}
                  >
                    {cat.name} {cat.count}
                  </Chip>
                ))}
                <MonoNote>most-bound categories</MonoNote>
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
      </OpSection>

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
  if (!res) return <EmptyState note="unrecognized revit.glance.attention shape" />;

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
        <EmptyState note="no active view reported" />
      ) : (
        <div
          className="min-w-0 px-3 py-2"
          style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <Chip hue={activeView.isSheet === true ? "green" : "blue"}>
              {text(activeView.viewType)}
            </Chip>
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
                  {
                    label: "candidate visible elements",
                    value: text(viewState.candidateVisibleElementCount),
                  },
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
        {visibleComposition.length === 0 ? (
          <EmptyState note="0 visible elements reported in the active view" />
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
      </OpSection>

      <OpSection label="can pea trust this view?">
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
                  <li
                    key={i}
                    className="text-[11px] leading-snug"
                    style={{ color: catVar("kiln") }}
                  >
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
      </OpSection>

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
