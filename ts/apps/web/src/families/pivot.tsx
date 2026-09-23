import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ReadCell } from "#/components/master-table/cells";
import { Press } from "#/components/lang/press";
import type { Column } from "#/components/master-table/model";
import { TableFrame } from "#/components/master-table/table-frame";
import { visibleRows } from "#/components/master-table/view";
import type { TypeRow } from "#/families/matrix-columns";
import { TypeGrid, GRID, identityWidth, type TypeGridEdit } from "#/families/pivot-grid";
import { PivotMinimap } from "#/families/pivot-minimap";
import { applyRules, buildPivot, familiesGrammar, type PivotRow } from "#/families/pivot-rules";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { ChatFocus } from "#/route/situation-ladder";

const rowKey = (row: PivotRow) => row.key;

const identityColumns: Column<PivotRow>[] = [
  {
    key: "name",
    label: "parameter",
    sort: (row) => row.name,
    search: (row) => row.name,
    cell: (row) => <ReadCell value={row.name} />,
  },
  {
    key: "kind",
    label: "kind",
    facet: (row) => row.kind,
    all: "any kind",
    cell: (row) => <ReadCell value={row.kind} />,
  },
  {
    key: "families",
    label: "fams",
    sort: (row) => row.families,
    cell: (row) => <ReadCell value={String(row.families)} />,
  },
  {
    key: "filled",
    label: "filled",
    sort: (row) => row.filled,
    cell: (row) => <ReadCell value={`${row.filled}/${row.present}`} />,
  },
];

export function FamiliesPivot({ empty, above }: { empty?: ReactNode; above?: ReactNode }) {
  const focus = useContext(ChatFocus);
  const {
    rows,
    params,
    families,
    tableState,
    store,
    archived,
    live,
    parse,
    chips: scopeChips,
  } = useFamiliesWorkspace();
  const { pivotRows, pivotFamilies } = useMemo(
    () => buildPivot(rows, params, families),
    [rows, params, families],
  );
  const focusKey = focus?.[0] ?? null;
  const appliedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusKey) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusKey) return;
    const param = params.find((entry) => entry.key === focusKey);
    if (param) {
      appliedFocus.current = focusKey;
      store.setPage({ query: `p:${encodeURIComponent(param.name)}` });
    }
  }, [focusKey, params, store.setPage]);
  const filtered = useMemo(
    () => applyRules(tableState.query, pivotRows, pivotFamilies),
    [tableState.query, pivotRows, pivotFamilies],
  );
  const grammar = useMemo(
    () => familiesGrammar(pivotRows, pivotFamilies),
    [pivotRows, pivotFamilies],
  );
  const [map, setMap] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const edit = useMemo<TypeGridEdit>(
    () => ({
      params: new Map(params.map((param) => [param.key, param])),
      live,
      propose: store.actions.propose,
      parse,
      readOnly: archived,
    }),
    [params, live, store.actions.propose, parse, archived],
  );
  const types = useMemo(() => {
    const byFamily = new Map<string, TypeRow[]>();
    for (const type of rows) {
      const own = byFamily.get(type.familyName) ?? [];
      own.push(type);
      byFamily.set(type.familyName, own);
    }
    return filtered.shownFamilies.flatMap((family) => byFamily.get(family.name) ?? []);
  }, [rows, filtered.shownFamilies]);
  const mappedRows = useMemo(
    () => visibleRows(filtered.shownRows, identityColumns, tableState, grammar),
    [filtered.shownRows, tableState, grammar],
  );
  return (
    <div className="flex size-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {above}
        <TableFrame
          label="parameters × family types"
          rows={filtered.shownRows}
          columns={identityColumns}
          rowKey={rowKey}
          state={tableState}
          onStateChange={store.actions.setTable}
          summary={`${mappedRows.length} parameters × ${filtered.shownFamilies.length} families · ${types.length} types`}
          query={{ grammar }}
          chips={scopeChips}
          actions={
            <Press
              type="button"
              frame="line"
              size="caption"
              state={map ? "selected" : "rest"}
              onClick={() => setMap(!map)}
              title={map ? "hide the minimap" : "show the minimap"}
              aria-pressed={map}
            >
              map
            </Press>
          }
        >
          <TypeGrid
            rows={mappedRows}
            types={types}
            families={filtered.shownFamilies}
            edit={edit}
            scroller={scroller}
            empty={mappedRows.length ? undefined : empty}
          />
        </TableFrame>
      </div>
      <PivotMinimap
        rows={mappedRows}
        types={types}
        scroller={scroller}
        open={map}
        onOpenChange={setMap}
        identityWidth={identityWidth}
        typeWidth={GRID.type}
        rowHeight={GRID.row}
        headerHeight={GRID.header}
      />
    </div>
  );
}
