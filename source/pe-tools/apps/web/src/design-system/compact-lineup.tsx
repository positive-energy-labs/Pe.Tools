/**
 * The /design-system/compact SATELLITE (route: `routes/design-system_.compact.tsx`), a protoui lineup. What it asks: **does a sheet-like
 * consumer get the dense row it needs from `MasterTable density="compact"`, so the hand tables
 * and `ops/primitives.tsx` `DataTable` can collapse into the one table?**
 *
 * Three ACCIDENT consumers from the table census, each on its own seed rows, each rendered
 * through the SAME columns in every variant — only the density (or, in the overreach, the
 * table count) changes. Throwaway: the winner is rewritten into canon, the rest deleted.
 *
 * GAPs the lineup exposes are drawn on the page with `Gap`, never covered by a local component.
 */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { Section } from "#/components/lang/section";
import { Switcher } from "#/components/lang/switcher";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { ReadCell } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Gap } from "#/design-system/exhibit";
import { DEMO_FAMILIES, FAMILIES_SEEDS } from "#/families/seeds";
import type { FamilyParameterSnapshot, FamilySnapshotRecord } from "#/host/loaded-families-view";
import type { PlanEntry } from "#/route/manifest";
import { STAT_ROWS, type StatRow } from "#/runs/browser/missing-panel";
import type { ZoneRecord } from "#/runs/world";

export const VARIANTS = ["today", "compact", "one-table"] as const;
export type Variant = (typeof VARIANTS)[number];

/** Plain text in the cell's own box — MasterTable's `td` is `p-0`. */
const text = (value: ReactNode) => (
  <span className="block truncate px-(--item-pad-x)">{value}</span>
);

/* ── 1 · route/plan-sheet.tsx — the confirmation sheet, on the families `?demo=apply` seed ─── */

const PLAN: readonly PlanEntry[] = FAMILIES_SEEDS.apply.page.sheet?.entries ?? [];
const PLAN_COLUMNS: Column<PlanEntry>[] = [
  {
    key: "subject",
    label: "subject",
    width: "w-48",
    sort: (e) => e.name,
    cell: (e) => text(e.name),
  },
  {
    key: "actions",
    label: "actions",
    right: true,
    width: "w-20",
    sort: (e) => e.actions,
    cell: (e) => <ReadCell value={e.actions} />,
  },
  {
    key: "source",
    label: "source",
    cell: (e) => <ReadCell value={e.detail} reason={e.detail} className="text-ink-2" />,
  },
  {
    key: "exception",
    label: "exception",
    facet: (e) => e.flag ?? "",
    cell: (e) => <ReadCell value={e.flag ?? ""} className="text-ink-mute" />,
  },
];

/* ── 2 · ops/views/detail/parameter-links.tsx FamilyMatrix (a DataTable), on DEMO_FAMILIES ─── */

interface MatrixRow {
  family: FamilySnapshotRecord;
  parameter: FamilyParameterSnapshot;
}
const MATRIX: readonly MatrixRow[] = DEMO_FAMILIES.flatMap((family) =>
  family.parameters.map((parameter) => ({ family, parameter })),
);
const typeValues = (r: MatrixRow) =>
  r.family.typeNames.map((t) => `${t} ${r.parameter.valuesPerType[t] ?? "∅"}`).join(" · ");
const MATRIX_COLUMNS: Column<MatrixRow>[] = [
  {
    key: "family",
    label: "family",
    width: "w-48",
    facet: (r) => r.family.familyName,
    sort: (r) => r.family.familyName,
    cell: (r) => text(r.family.familyName),
  },
  {
    key: "parameter",
    label: "parameter",
    sort: (r) => r.parameter.definition.identity.name ?? "",
    cell: (r) => text(r.parameter.definition.identity.name),
  },
  {
    key: "storage",
    label: "storage",
    width: "w-20",
    facet: (r) => r.parameter.storageType,
    cell: (r) => <ReadCell value={r.parameter.storageType} />,
  },
  // GAP (MasterTable): DataTable spreads one column per type name; a MasterTable over several
  // families has no per-row column set, so the per-type values are joined into one cell here.
  { key: "values", label: "values per type", cell: (r) => <ReadCell value={typeValues(r)} /> },
];

/* ── 3 · runs/browser/zone-card.tsx — the A/B stat sheet, through the real STAT_ROWS ──────── */

// STAND-IN: no exported zone fixture exists (world.test.ts builds one inline). These two records
// stand in for a captured run report's `Zones[n]`, baseline and current; replace with one.
const standInZone = (over: Partial<ZoneRecord>): ZoneRecord =>
  ({
    Level: "Main Level",
    Zone: "Main Level#03",
    OracleRooms: 9,
    AcceptedRooms: 7,
    HeldRooms: 2,
    AcceptedSqft: 1840,
    HeldSqft: 212,
    VoidSqft: 36,
    ExcludedSqft: 0,
    InkBackedEdgeFraction: 0.81,
    Rejections: { sliver: 3, "open-loop": 1 },
    adaptedKnobs: {},
    closure: { doorHeadSqft: 14, wallRunGapSqft: 6, gapCloseSqft: 20 },
    census: null,
    triage: { verdict: "solve", reason: "closed loops" },
    ...over,
  }) as ZoneRecord;
const ZONE_A = standInZone({});
const ZONE_B = standInZone({
  AcceptedRooms: 8,
  HeldRooms: 1,
  AcceptedSqft: 2010,
  HeldSqft: 64,
  InkBackedEdgeFraction: 0.86,
  Rejections: { sliver: 1 },
});
const ZONE_COLUMNS: Column<StatRow>[] = [
  { key: "stat", label: "stat", width: "w-24", cell: (r) => text(r.label) },
  { key: "a", label: "A · baseline", cell: (r) => text(r.value(ZONE_A)) },
  { key: "b", label: "B · current", cell: (r) => text(r.value(ZONE_B)) },
  {
    key: "delta",
    label: "Δ",
    right: true,
    width: "w-24",
    cell: (r) => text(r.delta?.(ZONE_A, ZONE_B) ?? ""),
  },
];

/* ── OVERREACH · one table for all three ─────────────────────────────────────────────────── */

interface AnyRow {
  key: string;
  source: string;
  subject: string;
  detail: string;
  value: ReactNode;
}
const ALL: readonly AnyRow[] = [
  ...PLAN.map((e) => ({
    key: `plan:${e.id}`,
    source: "plan sheet",
    subject: e.name,
    detail: e.detail,
    value: e.flag ?? `${e.actions} actions`,
  })),
  ...MATRIX.map((r) => ({
    key: `matrix:${r.parameter.definition.identity.key}:${r.family.familyId}`,
    source: "family matrix",
    subject: `${r.family.familyName} · ${r.parameter.definition.identity.name}`,
    detail: r.parameter.storageType,
    value: typeValues(r),
  })),
  ...STAT_ROWS.map((r) => ({
    key: `zone:${r.label}`,
    source: "zone A|B",
    subject: r.label,
    detail: "stand-in zone",
    value: r.value(ZONE_B),
  })),
];
const ALL_COLUMNS: Column<AnyRow>[] = [
  {
    key: "source",
    label: "source",
    width: "w-28",
    facet: (r) => r.source,
    sort: (r) => r.source,
    cell: (r) => text(r.source),
  },
  {
    key: "subject",
    label: "subject",
    width: "w-64",
    sort: (r) => r.subject,
    search: (r) => r.subject,
    cell: (r) => text(r.subject),
  },
  { key: "detail", label: "detail", width: "w-40", cell: (r) => text(r.detail) },
  { key: "value", label: "value", cell: (r) => text(r.value) },
];

export function CompactLineup({
  variant,
  onVariant,
}: {
  variant: Variant;
  onVariant: (next: Variant) => void;
}) {
  const compact = variant === "today" ? undefined : ("compact" as const);
  const [included, setIncluded] = useState<ReadonlySet<string>>(
    () => new Set(PLAN.filter((e) => e.flag === null).map((e) => e.id)),
  );

  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>compact mode</span>
            <FactChip
              dashed
              title="Seed rows from the families demo world, plus two stand-in zones — no host, no document."
            >
              fixture
            </FactChip>
          </div>
          <div className="flex items-center gap-3">
            <Switcher
              ariaLabel="variant"
              value={variant}
              onChange={onVariant}
              options={[
                {
                  value: "today",
                  label: "A · today",
                  title:
                    "Every table on MasterTable as it renders now: scope strip, column rules, default row.",
                },
                {
                  value: "compact",
                  label: "B · compact",
                  title: 'density="compact": no scope strip, hairline rows, mono one-line cells.',
                },
                {
                  value: "one-table",
                  label: "C · OVERREACH one table",
                  title:
                    "Past feasibility, on purpose: the three readouts as ONE compact table faceted by source.",
                },
              ]}
            />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-10 pt-8 pb-24">
        <p className="max-w-[78ch]">
          Three hand tables the census ruled ACCIDENT, each on its real seed rows and the same
          columns in every variant. A and B differ only by <code>density</code>. C is the overreach:
          it asks whether these readouts should be tables at all, or rows in the page&apos;s one
          table.
        </p>

        {variant === "one-table" ? (
          <Section label="C · OVERREACH · one table">
            <div className="flex h-96 flex-col">
              <MasterTable
                density="compact"
                rows={ALL}
                columns={ALL_COLUMNS}
                rowKey={(r) => r.key}
                scopeLabel="every readout on this page"
              />
            </div>
            <Gap>
              one table erases each readout&apos;s own verbs: the plan sheet&apos;s include toggle
              and apply have nowhere to live once its rows are mixed with a family matrix and a
              zone.
            </Gap>
          </Section>
        ) : (
          <>
            <Section label="1 · route/plan-sheet.tsx · families ?demo=apply">
              <div className="flex h-40 flex-col">
                <MasterTable
                  density={compact}
                  rows={PLAN}
                  columns={PLAN_COLUMNS}
                  rowKey={(e) => e.id}
                  scopeLabel="plan rows"
                  summary={`${included.size} / ${PLAN.length} included`}
                  selectedKeys={included}
                  onSelectedKeysChange={setIncluded}
                />
              </div>
              <Gap>
                selection stands in for the sheet&apos;s include toggle, but MasterTable cannot
                refuse one row: the flagged Air Handler selects like any other. The sheet needs a
                per-row selection refusal with its reason.
              </Gap>
              {compact && (
                <Gap>
                  compact drops the scope strip, and with it `summary` and select-all: the &quot;n /
                  m included&quot; count has no home on a compact table.
                </Gap>
              )}
            </Section>

            <Section label="2 · ops FamilyMatrix (DataTable) · DEMO_FAMILIES">
              <div className="flex h-48 flex-col">
                <MasterTable
                  density={compact}
                  rows={MATRIX}
                  columns={MATRIX_COLUMNS}
                  rowKey={(r) => `${r.family.familyId}:${r.parameter.definition.identity.key}`}
                  scopeLabel="loaded family parameters"
                />
              </div>
              <Gap>
                DataTable carries a `title` caption, a `footer` and a bounded `maxHeight`;
                MasterTable has none — here the caller bounds the height and the caption is this
                section label.
              </Gap>
            </Section>

            <Section label="3 · runs/browser/zone-card.tsx · STAT_ROWS over STAND-IN zones">
              <div className="flex h-56 flex-col">
                <MasterTable
                  density={compact}
                  rows={STAT_ROWS}
                  columns={ZONE_COLUMNS}
                  rowKey={(r) => r.label}
                  scopeLabel="zone Main Level#03 · A|B"
                />
              </div>
              <Gap>
                stand-in: no zone fixture is exported; the two zones are drawn here and would be
                replaced by a captured run report&apos;s Zones[n].
              </Gap>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
