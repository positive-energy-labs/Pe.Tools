import { familyCellAddress } from "@pe/agent-contracts";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ReadCell } from "#/components/master-table/cells";
import { Press } from "#/components/lang/press";
import type { Column, QueryVocabulary } from "#/components/master-table/model";
import { TableFrame } from "#/components/master-table/table-frame";
import {
  conditionValues,
  passes,
  quoted,
  readQuery,
  visibleRows,
  wordMatches,
  type QueryRead,
} from "#/components/master-table/view";
import type { ParamColumn, TypeRow } from "#/families/matrix-columns";
import { TypeGrid, GRID, identityWidth, type TypeGridEdit } from "#/families/pivot-grid";
import { PivotMinimap } from "#/families/pivot-minimap";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import type { FamilySnapshotRecord } from "#/host/loaded-families-view";
import { ChatFocus } from "#/route/situation-ladder";
import type { ParameterMetadataRecord } from "./parameter-metadata";

export const filledValue = (value: string | undefined) =>
  value !== undefined && value.trim() !== "";

export interface PivotRow {
  key: string;
  name: string;
  kind: string;
  families: number;
  filled: number;
  present: number;
  filledByFamily: Record<string, number>;
  /** The family's types that carry this parameter, in snapshot order. */
  typesByFamily: Record<string, TypeRow[]>;
}

export interface PivotFamily {
  name: string;
  category: string;
  types: number;
  placed: number;
  params: number;
}

export function buildPivot(
  rows: readonly TypeRow[],
  params: readonly ParamColumn[],
  families: readonly FamilySnapshotRecord[],
) {
  const byFamilyRows = new Map<string, TypeRow[]>();
  for (const row of rows) {
    const own = byFamilyRows.get(row.familyName) ?? [];
    own.push(row);
    byFamilyRows.set(row.familyName, own);
  }
  const pivotRows: PivotRow[] = params.map((param) => {
    const filledByFamily: Record<string, number> = {};
    const typesByFamily: Record<string, TypeRow[]> = {};
    let filled = 0;
    let present = 0;
    for (const family of families) {
      const carrying = (byFamilyRows.get(family.familyName) ?? []).filter(
        (row) => row.scopes[param.key] && row.scopes[param.key] !== "Unresolved",
      );
      if (!carrying.length) continue;
      typesByFamily[family.familyName] = carrying;
      const values = carrying.map((row) => row.values[param.key] ?? "");
      present += values.length;
      const nonBlank = values.filter(filledValue).length;
      filled += nonBlank;
      filledByFamily[family.familyName] = nonBlank;
    }
    return {
      key: param.key,
      name: param.name,
      kind: param.isBuiltIn ? "built-in" : param.isProjectOnly ? "project" : param.kind,
      families: param.familyCount,
      filled,
      present,
      filledByFamily,
      typesByFamily,
    };
  });
  const pivotFamilies: PivotFamily[] = families.map((family) => ({
    name: family.familyName,
    category: family.categoryName ?? "",
    types: family.typeNames.length,
    placed: family.placedInstanceCount ?? 0,
    params: pivotRows.filter((row) => row.typesByFamily[family.familyName]?.length).length,
  }));
  return { pivotRows, pivotFamilies };
}

type Field<Row> = QueryRead<Row> & { label: string; sort?: string };

/** Parameter fields count over the shown families; `sort` names the identity column. */
const PARAMETER_FIELDS: Field<PivotRow>[] = [
  { label: "parameter", kind: "text", read: (row) => row.name, sort: "name" },
  { label: "kind", kind: "text", read: (row) => row.kind },
  { label: "fams", kind: "number", read: (row) => row.families },
  { label: "filled", kind: "number", read: (row) => row.filled },
  {
    label: "filled%",
    kind: "number",
    read: (row) => (row.present ? Math.round((100 * row.filled) / row.present) : 0),
  },
];
const FAMILY_FIELDS: Field<PivotFamily>[] = [
  { label: "family", kind: "text", read: (family) => family.name },
  { label: "category", kind: "text", read: (family) => family.category },
  { label: "types", kind: "number", read: (family) => family.types },
  { label: "placed", kind: "number", read: (family) => family.placed },
];
const byLabel = <Row,>(fields: Field<Row>[]) =>
  new Map(fields.map((field) => [field.label.toLowerCase(), field]));
const PARAMETER_BY_LABEL = byLabel(PARAMETER_FIELDS);
const FAMILY_BY_LABEL = byLabel(FAMILY_FIELDS);

/** The statistics a field cannot say; `!` negates them like any word. */
const RULES: {
  word: string;
  label: string;
  row?: (row: PivotRow) => boolean;
  family?: (family: PivotFamily, rows: readonly PivotRow[]) => boolean;
}[] = [
  { word: "empty", label: "parameters blank in every shown type", row: (row) => row.filled === 0 },
  { word: "absent", label: "parameters on no shown family", row: (row) => row.families === 0 },
  {
    word: "valueless",
    label: "families blank in every shown parameter",
    family: (family, rows) => !rows.some((row) => (row.filledByFamily[family.name] ?? 0) > 0),
  },
];

/** The families query over both axes: family clauses narrow the type columns, parameter clauses
 * the rows, and each parameter recounts over the families still shown until the two settle. */
export function applyFamiliesQuery(
  query: string,
  rows: readonly PivotRow[],
  families: readonly PivotFamily[],
) {
  const clauses = readQuery(query);
  const rule = (word: string) => RULES.find((each) => each.word === word);
  let shownFamilies = families.filter((family) =>
    passes(family, clauses, FAMILY_BY_LABEL, () => undefined),
  );
  let shownRows: PivotRow[] = [];
  while (true) {
    shownRows = rows
      .map((row) => {
        let present = 0;
        let filled = 0;
        let familyCount = 0;
        for (const family of shownFamilies) {
          const types = row.typesByFamily[family.name];
          if (!types?.length) continue;
          familyCount++;
          present += types.length;
          filled += types.filter((type) => filledValue(type.values[row.key])).length;
        }
        return { ...row, families: familyCount, present, filled };
      })
      .filter((row) =>
        passes(row, clauses, PARAMETER_BY_LABEL, (each, word) => {
          const named = rule(word);
          return named ? named.row?.(each) : wordMatches(each.name, word);
        }),
      );
    const nextFamilies = shownFamilies.filter((family) =>
      passes(family, clauses, new Map(), (each, word) => rule(word)?.family?.(each, shownRows)),
    );
    if (nextFamilies.length === shownFamilies.length) break;
    shownFamilies = nextFamilies;
  }
  return { shownRows, shownFamilies };
}

function familiesVocabulary(
  rows: readonly PivotRow[],
  families: readonly PivotFamily[],
): QueryVocabulary {
  return {
    fields: [...PARAMETER_FIELDS, ...FAMILY_FIELDS],
    rules: RULES,
    count: (query) => applyFamiliesQuery(query, rows, families).shownRows.length,
    values: (label, query) => {
      const scope = applyFamiliesQuery(query, rows, families);
      const parameter = PARAMETER_BY_LABEL.get(label.toLowerCase());
      if (parameter) return conditionValues(scope.shownRows, parameter);
      const family = FAMILY_BY_LABEL.get(label.toLowerCase());
      return family ? conditionValues(scope.shownFamilies, family) : [];
    },
  };
}

/** What Pea reads of the query language: the rule words, then one line per field. */
export const FAMILIES_QUERY_HELP = [
  ...RULES.map((rule) => ({ insert: rule.word, label: rule.word, hint: rule.label })),
  ...[...PARAMETER_FIELDS, ...FAMILY_FIELDS].map((field) => ({
    insert: `${field.label}${field.kind === "number" ? ">=" : "~"}`,
    label: field.label,
    hint: `${field.kind} field: ~ = != > >= < <=, an empty value tests empty, ! negates, quote spaces`,
  })),
];

const rowKey = (row: PivotRow) => row.key;
const NEW_ROW = {
  kind: "new",
  filled: 0,
  present: 0,
  filledByFamily: {},
  typesByFamily: {},
} as const satisfies Partial<PivotRow>;

/** The identity columns order the rows; the families query narrows them. */
const identityColumns: Column<PivotRow>[] = [
  {
    key: "name",
    label: "parameter",
    sort: (row) => row.name,
    cell: (row) => <ReadCell value={row.name} />,
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
    overlay,
    chips: scopeChips,
  } = useFamiliesWorkspace();
  const { pivotRows, pivotFamilies } = useMemo(() => {
    const pivot = buildPivot(rows, params, families);
    // A parameter the patch creates gets its own row, marked new; the reading has no column for it.
    const created = Object.entries(overlay.parameters).flatMap(([name, entry]) =>
      entry.absent
        ? [{ ...NEW_ROW, key: `patch:${name}`, name, families: entry.families.length }]
        : [],
    );
    return { ...pivot, pivotRows: [...pivot.pivotRows, ...created] };
  }, [rows, params, families, overlay]);
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
      store.setPage({ query: `parameter=${quoted(param.name)}` });
    }
  }, [focusKey, params, store.setPage]);
  const filtered = useMemo(() => {
    const ruled = applyFamiliesQuery(tableState.query, pivotRows, pivotFamilies);
    // A row the patch writes is never hidden by a rule word; a parameter clause or a free word narrows it.
    const shown = new Set(ruled.shownRows.map(rowKey));
    const written = new Set([
      ...Object.keys(overlay.parameters),
      ...Object.keys(overlay.cells).map((key) => familyCellAddress(key).parameter),
    ]);
    const clauses = readQuery(tableState.query);
    const pinned = pivotRows.filter(
      (row) =>
        !shown.has(row.key) &&
        written.has(row.name) &&
        passes(row, clauses, PARAMETER_BY_LABEL, (each, word) =>
          RULES.some((rule) => rule.word === word) ? true : wordMatches(each.name, word),
        ),
    );
    return pinned.length ? { ...ruled, shownRows: [...ruled.shownRows, ...pinned] } : ruled;
  }, [tableState.query, pivotRows, pivotFamilies, overlay]);
  const vocabulary = useMemo(
    () => familiesVocabulary(pivotRows, pivotFamilies),
    [pivotRows, pivotFamilies],
  );
  const [map, setMap] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const edit = useMemo<TypeGridEdit>(() => {
    const metadata = new Map<string, ParameterMetadataRecord[]>();
    for (const family of families)
      for (const parameter of family.parameters ?? []) {
        const key = parameter.definition.identity.key;
        const entries = metadata.get(key) ?? [];
        entries.push({ family: family.familyName, parameter });
        metadata.set(key, entries);
      }
    return {
      metadata,
      params: new Map(params.map((param) => [param.key, param])),
      live,
      propose: store.actions.propose,
      parse,
      readOnly: archived,
      overlay,
    };
  }, [params, families, live, store.actions.propose, parse, archived, overlay]);
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
    () => visibleRows(filtered.shownRows, identityColumns, { ...tableState, query: "" }),
    [filtered.shownRows, tableState],
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
          query={vocabulary}
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
        overlay={overlay}
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
