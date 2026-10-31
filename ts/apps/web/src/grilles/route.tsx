import { FactChip } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import { KeyLegend, type LegendKey } from "@pe/kit/lang/key-hint";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { FieldChart, stepField } from "./chart";
import { ExportSheet } from "./export";
import { grillesGraph, type GrillesPage } from "./graph";
import { type GrilleInput, ribToFill, solve } from "./math";
import { Sheet, seedRows } from "./sheet";
import { SpecDrawing } from "./spec-drawing";
import { grillesSources, type solvePage } from "./sources";

type Body = MountBody<GrillesPage, null>;
const result = (body: Body) =>
  body.owner.readings.get("result").value as ReturnType<typeof solvePage> | undefined;
const FIELD_KEYS: readonly LegendKey[] = [
  { pointer: "click", does: "pick" },
  { keys: ["←", "→"], does: "qty" },
  { keys: ["↑", "↓"], does: "opening width" },
];

function edit(body: Body, id: string, patch: Partial<GrilleInput>) {
  body.owner.view.setPage({
    rows: body.page.rows.map((row) =>
      row.id === id ? { ...solve({ ...row, ...patch }), id } : row,
    ),
  });
}

function Drawing(body: Body) {
  const active = result(body)?.active;
  return (
    active && (
      <div data-surface="page" className="h-full overflow-auto">
        <SpecDrawing
          g={active}
          px={26}
          set={(patch) =>
            body.owner.view.setPage({
              rows: body.page.rows.map((row) => {
                const next = { ...row, ...patch };
                const rib = "rib" in patch ? next.rib : Math.max(0, ribToFill(next));
                return { ...solve({ ...next, rib }), id: row.id };
              }),
            })
          }
        />
      </div>
    )
  );
}

function Field(body: Body) {
  const value = result(body);
  if (!value?.active) return null;
  const { active, field } = value;
  return (
    <>
      <KeyLegend keys={FIELD_KEYS} lead={FIELD_KEYS.length} />
      <output aria-label="buildable profiles">{field.length} buildable</output>
      <TooltipHint content="Focus, then arrow keys: left/right walk qty, up/down walk opening width">
        <div
          tabIndex={0}
          aria-label="Buildable field"
          onKeyDown={(event) => {
            if (!event.key.startsWith("Arrow")) return;
            event.preventDefault();
            event.stopPropagation();
            const next = stepField(field, active, event.key);
            if (next) edit(body, active.id, next);
          }}
        >
          <FieldChart
            field={field}
            active={active}
            onPick={(patch) => edit(body, active.id, patch)}
          />
        </div>
      </TooltipHint>
    </>
  );
}

function Profiles(body: Body) {
  const value = result(body);
  if (!value) return <output role="status">Calculating grilles</output>;
  const { page, owner } = body;
  const setPage = owner.view.setPage;
  const picked = new Set(page.picked);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <FactChip
          tone="caution"
          dashed
          title="Seeded from the six workbook rows. Edits live in memory for this page view."
        >
          xlsx rows · in memory · writes nowhere
        </FactChip>
        <output aria-label="profile count">
          {value.rows.length} profiles · {picked.size} to export
        </output>
        <Button
          label={`export ${picked.size} drawing${picked.size === 1 ? "" : "s"}`}
          kind="framed"
          onClick={() => setPage({ sheet: true })}
        >
          export {picked.size} drawing{picked.size === 1 ? "" : "s"}
        </Button>
        <Button label="reset" kind="framed" onClick={() => setPage({ rows: seedRows() })}>
          reset
        </Button>
      </div>
      <Sheet
        rows={value.rows}
        active={page.row}
        onActive={(row) => setPage({ row })}
        set={(id, patch) => edit(body, id, patch)}
        add={() => {
          const src = value.active ?? value.rows.at(-1) ?? seedRows()[0]!;
          const id = `new${value.rows.length + 1}`;
          setPage({ rows: [...page.rows, { ...src, id }], row: id });
        }}
        picked={picked}
        onPickedChange={(next) => setPage({ picked: [...next] })}
      />
      {page.sheet && (
        <ExportSheet
          rows={value.rows.filter((row) => picked.has(row.id))}
          project={page.project}
          onProject={(project) => setPage({ project })}
          onClose={() => setPage({ sheet: false })}
        />
      )}
    </>
  );
}

export const grillesAdapters: RouteAdapters<GrillesPage, null> = {
  sources: grillesSources,
  bodies: { drawing: Drawing, field: Field, profiles: Profiles },
};
export const grillesRoute = routeFromGraph(grillesGraph, grillesAdapters, "/grilles");
