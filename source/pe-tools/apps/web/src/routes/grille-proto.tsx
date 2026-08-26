/**
 * /grille-proto — THROWAWAY. find-the-product, round 2: the CUSTOM WOOD FLOOR GRILLE calculator.
 *
 * ROUND 1 RULINGS (2026-08-25): the table is the product, like /family; the drawing is the ONLY
 * pane carrying per-slot information, with an input on every witness line, drawn like a Price
 * submittal; no drawing in the row; the chart is a keeper, more axes wanted; colours abide
 * design-lang (wood as a section hatch, not a brown fill).
 *
 * ROUND 2 LINEUP — one page shape, three CHART forms under `?chart=rib|count|grid`: the sheet on
 * top (MasterTable, canon), the active row drawn below-left, the feasible field charted
 * below-right. Clicking a chart point writes into the active row.
 *
 * OWED: MasterTable row compactness (ruled round 1: "my master-table is not compact enough");
 * a fit-to-pane drawing scale; whether the field's MIN_RIB is law or lore.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { CHARTS, Chart } from "#/grille-proto/charts";
import { type GrilleInput, enumerate, solve } from "#/grille-proto/math";
import { type SheetRow, Sheet, seedRows } from "#/grille-proto/sheet";
import { SpecDrawing } from "#/grille-proto/spec-drawing";
import { VariantSwitcher } from "#/param-tables/proto/switcher";

export const Route = createFileRoute("/grille-proto")({
  validateSearch: (search: Record<string, unknown>): { chart: string } => ({
    chart: typeof search.chart === "string" ? search.chart : "rib",
  }),
  component: GrilleProto,
});

function GrilleProto() {
  const { chart } = Route.useSearch();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SheetRow[]>(seedRows);
  const [activeId, setActiveId] = useState("row7");
  const active = rows.find((r) => r.id === activeId) ?? rows[0];

  const set = (id: string, p: Partial<GrilleInput>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...solve({ ...r, ...p }), id } : r)));
  const add = () =>
    setRows((rs) => {
      const src = rs.find((r) => r.id === activeId) ?? rs[rs.length - 1] ?? seedRows()[0]!;
      const id = `new${rs.length + 1}`;
      setActiveId(id);
      return [...rs, { ...src, id }];
    });

  const field = useMemo(() => (active ? enumerate(active) : []), [active]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <header
        className="flex flex-wrap items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--r-line)" }}
      >
        <span className="face-mono t-label t-upper text-[var(--r-ink-mute)]">
          wood floor grille
        </span>
        <span className="t-value text-[var(--r-ink)]">free area calculator</span>
        <FactChip
          tone="caution"
          dashed
          title="Seeded from the six rows of PE Custom Wood Floor Grille Calculator.xlsx. Edits live in memory for this page view and are written nowhere."
        >
          xlsx rows · in memory · writes nowhere
        </FactChip>
        <button
          type="button"
          className="face-mono text-[11px] text-[var(--r-nav)]"
          onClick={() => setRows(seedRows())}
        >
          reset
        </button>
      </header>

      <Sheet rows={rows} active={activeId} onActive={setActiveId} set={set} add={add} />

      {active && (
        <div className="flex flex-wrap gap-6 border-t p-3" style={{ borderColor: "var(--r-line)" }}>
          <SpecDrawing g={active} set={(p) => set(active.id, p)} />
          <div className="flex flex-col gap-1">
            <span className="face-mono t-label t-upper text-[var(--r-ink-mute)]">
              {CHARTS.find((c) => c.key === chart)?.name} · {field.length} buildable profiles for
              this stock
            </span>
            <Chart kind={chart} field={field} active={active} onPick={(p) => set(active.id, p)} />
          </div>
        </div>
      )}

      <VariantSwitcher
        variants={CHARTS}
        current={chart}
        onSelect={(key) => navigate({ to: "/grille-proto", search: { chart: key } })}
      />
    </div>
  );
}
