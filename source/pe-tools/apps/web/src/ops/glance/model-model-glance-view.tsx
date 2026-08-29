import { FactChip } from "#/components/lang/chip";
import { CoverageBar } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { VizChip } from "#/ops/primitives";
import { UnrecognizedShape, asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticViewProps } from "#/ops/synthetic";
import { MonoAside, SERIES_META, Stat, categoryViz, composition, obs } from "./model-viz-cycle";

export function ModelGlanceView({ results, observedAtMs }: SyntheticViewProps) {
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
      <div className="min-w-0 rounded-sm border border-line-2 px-3 py-2">
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

      <div className="flex flex-wrap rounded-sm border border-line">
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
