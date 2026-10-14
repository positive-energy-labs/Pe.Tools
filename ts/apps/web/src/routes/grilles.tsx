import { RouteShell, useRoute } from "#/route";
import { token } from "@pe/kit/lib/token";
/**
 * /grilles — the custom wood floor grille calculator.
 *
 * Carries the math of `PE Custom Wood Floor Grille Calculator.xlsx` (`grilles/math.ts`, a 1:1
 * port pinned by `math.test.ts`) and shows the grille while you edit it. PROMOTED 2026-08-25
 * from `/grille-proto` after three find-the-product rounds; the rulings it embodies:
 *
 *   · the table is the product (as /family): one Table row per candidate profile.
 *   · the drawing is the ONLY pane carrying per-slot information — plan + section A-A at 2×,
 *     drawn like a Price submittal, an input on every witness line. Its inputs are the SHARED
 *     dimensions: one edit writes every row; rib auto-spaces to close the middle unless rib
 *     itself was typed.
 *   · the field chart (free % on y, qty on x, a line per opening width) beside it; click a
 *     point or focus and use arrow keys to walk the buildable profiles into the active row.
 *   · export = tick rows → one printable sheet (print to PDF, or .svg per drawing).
 *
 * Rows live in memory for the page view (persistence is Owed in the feature ledger).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, type SetStateAction } from "react";

import { FactChip } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { FieldChart, stepField } from "#/grilles/chart";
import { ExportSheet } from "#/grilles/export";
import { type GrilleInput, enumerate, ribToFill, solve } from "#/grilles/math";
import { type SheetRow, Sheet, seedRows } from "#/grilles/sheet";
import { SpecDrawing } from "#/grilles/spec-drawing";

import { grillesManifest as manifest } from "#/route/surface-manifests";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export const Route = createFileRoute("/grilles")({ component: GrillesRoute });

function GrillesRoute() {
  const handle = useRoute(manifest, { target: null });
  const [page, setPage] = handle.page;
  const { rows, activeId, drawingCollapsed, exporting, project } = page;
  const picked = new Set(page.picked);
  const setRows = (next: SetStateAction<SheetRow[]>) =>
    setPage({ rows: typeof next === "function" ? next(rows) : next });
  const setActiveId = (activeId: string) => setPage({ activeId });
  const setPicked = (picked: ReadonlySet<string>) => setPage({ picked: [...picked] });
  const setDrawingCollapsed = (next: SetStateAction<boolean>) =>
    setPage({ drawingCollapsed: typeof next === "function" ? next(drawingCollapsed) : next });
  const setExporting = (exporting: boolean) => setPage({ exporting });
  const setProject = (project: string) => setPage({ project });
  const active = rows.find((r) => r.id === activeId) ?? rows[0];

  const set = (id: string, p: Partial<GrilleInput>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...solve({ ...r, ...p }), id } : r)));
  /** The drawing's inputs are the shared dimensions: they write to every row. */
  const setAll = (p: Partial<GrilleInput>) =>
    setRows((rs) =>
      rs.map((r) => {
        const next = { ...r, ...p };
        const rib = "rib" in p ? next.rib : Math.max(0, ribToFill(next));
        return { ...solve({ ...next, rib }), id: r.id };
      }),
    );
  const add = () =>
    setRows((rs) => {
      const src = rs.find((r) => r.id === activeId) ?? rs[rs.length - 1] ?? seedRows()[0]!;
      const id = `new${rs.length + 1}`;
      setActiveId(id);
      return [...rs, { ...src, id }];
    });
  const field = useMemo(() => (active ? enumerate(active) : []), [active]);

  const drawing = (
    <Pane
      scroll="clip"
      flush
      title="drawing"
      meta={
        drawingCollapsed
          ? "collapsed — the header strip stays so the drawing is one click away"
          : "plan + section A-A of the active profile · type on any dimension to set it for every row; rib auto-spaces"
      }
      actions={
        <Button
          label={drawingCollapsed ? "show" : "hide"}
          kind="framed"
          onClick={() => setDrawingCollapsed((c) => !c)}
          reason={
            drawingCollapsed
              ? "Show the drawing again."
              : "Collapse the drawing. Its header strip stays, so only the height changes."
          }
        >
          {drawingCollapsed ? "show" : "hide"}
        </Button>
      }
    >
      {active && !drawingCollapsed && (
        <div data-surface="artifact" className="h-full overflow-auto">
          <SpecDrawing g={active} set={setAll} px={26} />
        </div>
      )}
    </Pane>
  );

  const table = (
    <Pane
      flush
      title="profiles"
      meta={`${rows.length} candidate profiles · ${picked.size} on the export sheet`}
      actions={
        <>
          <Button
            label={`export ${picked.size} drawing${picked.size === 1 ? "" : "s"}`}
            kind="framed"
            onClick={() => setExporting(true)}
            reason="Open the export sheet: the ticked profiles drawn read-only on one page, print to PDF or save each as .svg."
          >
            {`export ${picked.size} drawing${picked.size === 1 ? "" : "s"}`}
          </Button>
          <Button
            label="reset"
            kind="framed"
            onClick={() => setRows(seedRows())}
            reason="Throw away every edit and re-read the six workbook rows."
          >
            reset
          </Button>
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
        onPickedChange={setPicked}
      />
    </Pane>
  );

  const chart = (
    <Pane
      flush
      title="field"
      meta={`free % vs qty, per opening width · ${field.length} buildable profiles for this stock`}
    >
      {active && (
        <TooltipHint content="Focus, then arrow keys: left/right walk qty, up/down walk opening width">
          <div
            tabIndex={0}
            onKeyDown={(e) => {
              if (!e.key.startsWith("Arrow")) return;
              e.preventDefault();
              e.stopPropagation();
              const next = stepField(field, active, e.key);
              if (next) set(active.id, next);
            }}
          >
            <FieldChart field={field} active={active} onPick={(p) => set(active.id, p)} />
            <p className="px-2">
              click a point, or focus and use arrow keys: ←→ qty · ↑↓ opening width
            </p>
          </div>
        </TooltipHint>
      )}
    </Pane>
  );

  return (
    <RouteShell manifest={manifest} handle={handle}>
      <Surface>
        <header
          className="flex flex-wrap items-baseline gap-2 px-3 py-2"
          style={{ borderColor: token("line") }}
        >
          <span>wood floor grille</span>
          <span>free area calculator</span>
          <FactChip
            tone="caution"
            dashed
            title="Seeded from the six rows of PE Custom Wood Floor Grille Calculator.xlsx. Edits live in memory for this page view and are written nowhere."
          >
            xlsx rows · in memory · writes nowhere
          </FactChip>
        </header>

        <PaneSplit
          axis="vertical"
          grow
          resize={{
            target: "start",
            defaultSize: 420,
            minSize: 34,
            collapse: {
              collapsed: drawingCollapsed,
              onCollapsedChange: setDrawingCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          }}
          start={
            <PaneSplit
              axis="horizontal"
              grow
              resize={{ target: "end", defaultSize: 500, minSize: 420, minOtherSize: 560 }}
              start={drawing}
              end={chart}
            />
          }
          end={table}
        />

        {exporting && (
          <ExportSheet
            rows={rows.filter((r) => picked.has(r.id))}
            project={project}
            onProject={setProject}
            onClose={() => setExporting(false)}
          />
        )}
      </Surface>
    </RouteShell>
  );
}
