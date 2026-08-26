/**
 * /grille-proto — THROWAWAY. find-the-product, round 3: the CUSTOM WOOD FLOOR GRILLE calculator.
 *
 * RULINGS SO FAR (2026-08-25): the table is the product, like /family; the drawing is the ONLY
 * pane carrying per-slot information, an input on every witness line, drawn like a Price
 * submittal; chart #2 (free % vs qty, one line per opening width) is the preferred style.
 *
 * ROUND 3 SHAPE — mirrors /family: PaneWorkspace with the drawing as a hideable VISUAL pane up
 * top split with the chart as its INSPECTOR (not hideable, min width set), the sheet as
 * full-width CONTENT below. The chart pane is focusable; arrow keys walk the field. Rows ticked "sheet"
 * go to the EXPORT SHEET (print to PDF, or .svg per drawing) — what the engineer hands the
 * architect. `?chart=` keeps the other two chart forms one keypress away for comparison.
 *
 * OWED: MasterTable row compactness (design-system ledger); fit-to-pane drawing scale.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { Verb } from "#/components/lang/verb";
import { Pane, PaneWorkspace } from "#/components/ui/pane";
import { CHARTS, Chart, stepField } from "#/grille-proto/charts";
import { ExportSheet } from "#/grille-proto/export";
import { type GrilleInput, enumerate, ribToFill, solve } from "#/grille-proto/math";
import { type SheetRow, Sheet, seedRows } from "#/grille-proto/sheet";
import { SpecDrawing } from "#/grille-proto/spec-drawing";
import { VariantSwitcher } from "#/param-tables/proto/switcher";

export const Route = createFileRoute("/grille-proto")({
  validateSearch: (search: Record<string, unknown>): { chart: string } => ({
    chart: typeof search.chart === "string" ? search.chart : "count", // ruled 2026-08-25: count wins
  }),
  component: GrilleProto,
});

function GrilleProto() {
  const { chart } = Route.useSearch();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SheetRow[]>(seedRows);
  const [activeId, setActiveId] = useState("row7");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(["row7"]));
  const [drawingCollapsed, setDrawingCollapsed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [project, setProject] = useState("");
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
  /** The drawing's inputs are the SHARED dimensions: they write to every row (ruled 2026-08-25).
   *  Rib auto-spaces to close the middle unless rib itself was typed. */
  const setAll = (p: Partial<GrilleInput>) =>
    setRows((rs) =>
      rs.map((r) => {
        const next = { ...r, ...p };
        const rib = "rib" in p ? next.rib : Math.max(0, ribToFill(next));
        return { ...solve({ ...next, rib }), id: r.id };
      }),
    );
  const pick = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const field = useMemo(() => (active ? enumerate(active) : []), [active]);
  const chartName = CHARTS.find((c) => c.key === chart)?.name ?? chart;

  const drawing = (
    <Pane
      kind="visual"
      title="drawing"
      meta={
        drawingCollapsed
          ? "collapsed — the header strip stays so the drawing is one click away"
          : active
            ? `plan + section A-A of the active profile · type on any dimension to set it for EVERY row; rib auto-spaces`
            : "no profile"
      }
      actions={
        <Verb
          label={drawingCollapsed ? "show" : "hide"}
          onClick={() => setDrawingCollapsed((c) => !c)}
          reason={
            drawingCollapsed
              ? "Show the drawing again."
              : "Collapse the drawing. Its header strip stays, so only the height changes."
          }
        />
      }
    >
      {active && !drawingCollapsed && (
        <div className="h-full overflow-auto p-2">
          <SpecDrawing g={active} set={setAll} px={26} />
        </div>
      )}
    </Pane>
  );

  const table = (
    <Pane
      kind="content"
      title="profiles"
      meta={`${rows.length} candidate profiles · ${picked.size} on the export sheet`}
      actions={
        <>
          <Verb
            label={`export ${picked.size} drawing${picked.size === 1 ? "" : "s"}`}
            onClick={() => setExporting(true)}
            reason="Open the export sheet: the ticked profiles drawn read-only on one page, print to PDF or save each as .svg."
          />
          <Verb
            label="reset"
            onClick={() => setRows(seedRows())}
            reason="Throw away every edit and re-read the six workbook rows."
          />
        </>
      }
    >
      <Sheet
        rows={rows}
        active={activeId}
        onActive={setActiveId}
        set={set}
        add={add}
        picked={picked}
        onPick={pick}
      />
    </Pane>
  );

  const chartPane = (
    <Pane
      kind="inspector"
      title="field"
      meta={`${chartName} · ${field.length} buildable profiles for this stock`}
    >
      {active && (
        <div
          tabIndex={0}
          className="outline-none focus-visible:ring-1 focus-visible:ring-[var(--r-line-2)]"
          title="Focus, then arrow keys: left/right walk qty, up/down walk opening width"
          onKeyDown={(e) => {
            if (!e.key.startsWith("Arrow")) return;
            // the pane owns arrow keys while focused, even at an edge — never the variant switcher
            e.preventDefault();
            e.stopPropagation();
            const next = stepField(field, active, e.key);
            if (next) set(active.id, next);
          }}
        >
          <Chart kind={chart} field={field} active={active} onPick={(p) => set(active.id, p)} />
          <p className="face-mono px-2 text-[10px] text-[var(--r-ink-mute)]">
            click a point, or focus and use arrow keys: ←→ qty · ↑↓ opening width
          </p>
        </div>
      )}
    </Pane>
  );

  return (
    <main className="flex h-full min-h-0 flex-col">
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
      </header>

      <PaneWorkspace
        className="min-h-0 flex-1"
        visual={drawing}
        content={table}
        inspector={chartPane}
        inspectorSpan="visual"
        resize={{
          visual: {
            defaultSize: 420,
            minSize: 34,
            collapse: {
              collapsed: drawingCollapsed,
              onCollapsedChange: setDrawingCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          },
          inspector: { defaultSize: 500, minSize: 420, minOtherSize: 560 },
        }}
      />

      {exporting && (
        <ExportSheet
          rows={rows.filter((r) => picked.has(r.id))}
          project={project}
          onProject={setProject}
          onClose={() => setExporting(false)}
        />
      )}

      <VariantSwitcher
        variants={CHARTS}
        current={chart}
        onSelect={(key) => navigate({ to: "/grille-proto", search: { chart: key } })}
      />
    </main>
  );
}
