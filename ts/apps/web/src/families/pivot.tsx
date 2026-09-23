import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ReadCell } from "#/components/master-table/cells";
import { ListPopup } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import type { Column } from "#/components/master-table/model";
import { TableFrame } from "#/components/master-table/table-frame";
import { visibleRows } from "#/components/master-table/view";
import type { TypeRow } from "#/families/matrix-columns";
import { TypeGrid, GRID, identityWidth, type TypeGridEdit } from "#/families/pivot-grid";
import { PivotMinimap } from "#/families/pivot-minimap";
import {
  applyRules,
  buildPivot,
  decoded,
  DEFAULT_FAMILIES_RULES,
  removeToken,
  suggestionsFor,
  type PivotRow,
} from "#/families/pivot-rules";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { ChatFocus } from "#/route/situation-ladder";

const rowKey = (row: PivotRow) => row.key;

function tokenAt(text: string, caret: number) {
  const start = text.lastIndexOf(" ", caret - 1) + 1;
  const end = text.indexOf(" ", caret);
  return { start, end: end === -1 ? text.length : end, text: text.slice(start, caret) };
}

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
  const rules = tableState.rules ?? DEFAULT_FAMILIES_RULES;
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
      store.setPage({ rules: `p:${encodeURIComponent(param.name)}` });
    }
  }, [focusKey, params, store.setPage]);
  const filtered = useMemo(
    () => applyRules(rules, pivotRows, pivotFamilies),
    [rules, pivotRows, pivotFamilies],
  );
  const setRules = (next: string) =>
    store.actions.setTable((current) => ({ ...current, rules: next }));
  const [map, setMap] = useState(true);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const input = useRef<HTMLInputElement>(null);
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
    () => visibleRows(filtered.shownRows, identityColumns, tableState),
    [filtered.shownRows, tableState],
  );
  const token = tokenAt(rules, caret);
  const suggestions = useMemo(
    () => suggestionsFor(token.text.toLowerCase(), pivotFamilies, pivotRows),
    [token.text, pivotFamilies, pivotRows],
  );
  const accept = (entry: { insert: string }) => {
    const trailing = entry.insert.endsWith(":") || entry.insert === "!" ? "" : " ";
    const next = `${rules.slice(0, token.start)}${entry.insert}${trailing}${rules.slice(token.end).trimStart()}`;
    setRules(next);
    const at = token.start + entry.insert.length + trailing.length;
    setCaret(at);
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
  };
  const ruleChips = rules
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !filtered.unknown.includes(word))
    .map((word) => {
      const rule = filtered.rules.find((entry) => entry.word === word.toLowerCase());
      const number = filtered.numbers.find((entry) => entry.raw === word);
      const label =
        rule?.label ??
        number?.label ??
        (word.startsWith("!")
          ? `hide ${decoded(word.slice(1))}`
          : word.startsWith("f:")
            ? `families containing ${decoded(word.slice(2))}`
            : `parameters containing ${decoded(word.slice(2))}`);
      return { label, onClear: () => setRules(removeToken(rules, word)) };
    });

  return (
    <div className="flex size-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {above}
        <div className="relative border-b px-2 py-1 t-small">
          <div className="flex items-center gap-2">
            <span className="face-mono text-ink-2">rules</span>
            <input
              ref={input}
              aria-label="families table rules"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={focused && suggestions.length > 0}
              className="face-mono flex-1 border px-1"
              value={rules}
              placeholder="type a rule, or focus for the full list"
              onChange={(event) => {
                setRules(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                setFocused(true);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
            {filtered.unknown.length > 0 && (
              <span className="text-ink-mute">unknown: {filtered.unknown.join(" ")}</span>
            )}
          </div>
          <ListPopup<{ insert: string; label: string; hint: string }>
            anchor="caret"
            caret={input.current}
            owner={input.current}
            open={focused && suggestions.length > 0}
            onOpenChange={setFocused}
            query={token.text}
            aria-label="families rule suggestions"
            items={suggestions}
            keyOf={(entry) => entry.insert}
            labelOf={(entry) => entry.label}
            filter="none"
            empty="no rules"
            maxHeight="14rem"
            onPick={accept}
            row={(entry) => ({ label: entry.label, meta: entry.hint })}
          />
        </div>
        <TableFrame
          label="parameters × family types"
          rows={filtered.shownRows}
          columns={identityColumns}
          rowKey={rowKey}
          state={tableState}
          onStateChange={store.actions.setTable}
          summary={`${mappedRows.length} parameters × ${filtered.shownFamilies.length} families · ${types.length} types`}
          chips={[...scopeChips, ...ruleChips]}
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
