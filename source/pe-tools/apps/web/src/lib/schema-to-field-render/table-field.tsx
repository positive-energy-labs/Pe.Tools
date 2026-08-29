import { Verb } from "#/components/lang/verb";
import { Input } from "#/components/lang/input";
import type { SchemaNodeRef } from "@pe/schema-core";
import {
  FieldChangeBadge,
  FieldLabelRow,
  FieldMessages,
  FieldOptionsMetadata,
} from "./field-metadata";
import {
  primitiveInputValue,
  type ResolvedFieldRendererProps,
  useFieldOptions,
  useSettingsField,
} from "./shared";

type TableRow = Record<string, unknown>;

function collectObservedDynamicColumnKeys(
  rows: TableRow[],
  fixedColumnKeys: Set<string>,
): string[] {
  const observed: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (fixedColumnKeys.has(key) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      observed.push(key);
    }
  }

  return observed;
}

function mergeDynamicColumnKeys(preferredKeys: string[], observedKeys: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const key of [...preferredKeys, ...observedKeys]) {
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(key);
  }

  return merged;
}

function normalizeRowOrder(
  row: TableRow,
  fixedColumnKeys: string[],
  dynamicColumnKeys: string[],
): TableRow {
  const normalized: TableRow = {};

  for (const key of fixedColumnKeys) {
    if (key in row) {
      normalized[key] = row[key];
    }
  }

  for (const key of dynamicColumnKeys) {
    if (key in row) {
      normalized[key] = row[key];
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (key in normalized) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function normalizeRows(
  rows: TableRow[],
  fixedColumnKeys: string[],
  dynamicColumnKeys: string[],
): TableRow[] {
  return rows.map((row) => normalizeRowOrder(row, fixedColumnKeys, dynamicColumnKeys));
}

function createRowTemplate(
  fixedColumns: Array<readonly [string, SchemaNodeRef | undefined]>,
  dynamicColumnKeys: string[],
  missingValue: string,
): TableRow {
  const nextRow: TableRow = {};

  for (const [columnKey, columnRef] of fixedColumns) {
    nextRow[columnKey] = columnRef?.hasExplicitDefault() ? columnRef.explicitDefault() : "";
  }

  for (const columnKey of dynamicColumnKeys) {
    nextRow[columnKey] = missingValue;
  }

  return nextRow;
}

function TableCellField({
  path,
  value,
  onChange,
  list,
}: {
  path: string;
  value: unknown;
  onChange: (nextValue: string) => void;
  list?: string;
}) {
  const field = useSettingsField(path);
  return (
    <div className="space-y-1">
      <Input
        list={list}
        value={primitiveInputValue(field.value ?? value)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FieldChangeBadge path={path} compact />
      </div>
      <FieldMessages messages={field.errors} compact />
    </div>
  );
}

export function TableField({ path, effectiveNodeRef, label }: ResolvedFieldRendererProps) {
  const field = useSettingsField(path);
  const itemNodeRef = effectiveNodeRef.item()?.effective();
  const uiMetadata = effectiveNodeRef.uiMetadata();
  const fixedColumnKeys =
    uiMetadata?.behavior?.fixedColumns && uiMetadata.behavior.fixedColumns.length > 0
      ? uiMetadata.behavior.fixedColumns
      : (itemNodeRef?.sortedProperties().map(([columnKey]) => columnKey) ?? []);
  const fixedColumns = fixedColumnKeys.map(
    (columnKey) => [columnKey, itemNodeRef?.child(columnKey)?.effective()] as const,
  );
  const fixedColumnKeySet = new Set(fixedColumnKeys);
  const primaryColumnKey = fixedColumnKeys[0];
  const primaryColumnRef = primaryColumnKey
    ? itemNodeRef?.child(primaryColumnKey)?.effective()
    : undefined;
  const primaryColumnOptions = useFieldOptions({
    node: primaryColumnRef ?? itemNodeRef ?? effectiveNodeRef,
    providerNode: primaryColumnRef?.optionSource() ? primaryColumnRef : undefined,
    fieldPath: primaryColumnKey ? `${path}.0.${primaryColumnKey}` : path,
  });
  const optionValues = primaryColumnOptions.items
    .map((item) => item.value.trim())
    .filter((value) => value.length > 0);
  const datalistId = `${path.replaceAll(".", "-")}-table-primary-column-options`;
  const description = effectiveNodeRef.description();
  const defaultValue = effectiveNodeRef.hasExplicitDefault()
    ? effectiveNodeRef.explicitDefault()
    : undefined;
  const missingValue = uiMetadata?.behavior?.missingValue ?? "";

  const rows = Array.isArray(field.value) ? (field.value as TableRow[]) : [];
  const preferredDynamicColumns = uiMetadata?.behavior?.dynamicColumnOrder?.values ?? [];
  const observedDynamicColumns = collectObservedDynamicColumnKeys(rows, fixedColumnKeySet);
  const dynamicColumnKeys = mergeDynamicColumnKeys(preferredDynamicColumns, observedDynamicColumns);
  const commitRows = (nextRows: TableRow[], nextDynamicColumns: string[] = dynamicColumnKeys) =>
    field.change(normalizeRows(nextRows, fixedColumnKeys, nextDynamicColumns));
  const updateCell = (rowIndex: number, columnKey: string, nextValue: string) =>
    commitRows(
      rows.map((row, index) => (index === rowIndex ? { ...row, [columnKey]: nextValue } : row)),
    );
  const addColumn = () => {
    const base = "NewType";
    let next = base;
    let suffix = 1;
    const existing = new Set([...fixedColumnKeys, ...dynamicColumnKeys]);
    while (existing.has(next)) next = `${base}${++suffix}`;
    const columns = [...dynamicColumnKeys, next];
    commitRows(
      rows.length
        ? rows.map((row) => ({ ...row, [next]: missingValue }))
        : [createRowTemplate(fixedColumns, columns, missingValue)],
      columns,
    );
  };
  const renameColumn = (columnKey: string, nextColumnKey: string) => {
    const trimmed = nextColumnKey.trim();
    if (
      !trimmed ||
      trimmed === columnKey ||
      fixedColumnKeySet.has(trimmed) ||
      dynamicColumnKeys.includes(trimmed)
    )
      return;
    const columns = dynamicColumnKeys.map((key) => (key === columnKey ? trimmed : key));
    commitRows(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key === columnKey ? trimmed : key, value]),
        ),
      ),
      columns,
    );
  };
  const removeColumn = (columnKey: string) =>
    commitRows(
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== columnKey)),
      ),
      dynamicColumnKeys.filter((key) => key !== columnKey),
    );
  const addRow = () =>
    field.push(
      normalizeRowOrder(
        createRowTemplate(fixedColumns, dynamicColumnKeys, missingValue),
        fixedColumnKeys,
        dynamicColumnKeys,
      ),
    );

  return (
    <div className="space-y-3">
      <FieldLabelRow
        label={label}
        required={effectiveNodeRef.isRequired()}
        description={description}
        defaultValue={defaultValue}
        path={path}
      />
      <FieldMessages messages={field.errors} />
      <div className="overflow-auto">
        <table className="min-w-full">
          <thead className="text-left">
            <tr>
              {fixedColumns.map(([columnKey]) => (
                <th key={columnKey} className="px-3 py-2">
                  {columnKey}
                </th>
              ))}
              {dynamicColumnKeys.map((columnKey) => (
                <th key={columnKey} className="min-w-36 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Input
                      defaultValue={columnKey}
                      onBlur={(event) => renameColumn(columnKey, event.currentTarget.value)}
                    />
                    <Verb
                      label="remove"
                      reason={`Drop the "${columnKey}" column from every row of this table. The change lives in the form until save writes it.`}
                      onClick={() => removeColumn(columnKey)}
                    />
                  </div>
                </th>
              ))}
              <th className="w-24 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={fixedColumns.length + dynamicColumnKeys.length + 1}
                  className="px-3 py-6 text-center"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={`${path}.${rowIndex}`} className="align-top">
                  {fixedColumns.map(([columnKey], fixedColumnIndex) => {
                    const cellPath = `${path}.${rowIndex}.${columnKey}`;
                    return (
                      <td key={columnKey} className="px-3 py-2">
                        <TableCellField
                          path={cellPath}
                          value={row[columnKey]}
                          list={
                            fixedColumnIndex === 0 && optionValues.length > 0
                              ? datalistId
                              : undefined
                          }
                          onChange={(nextValue) => updateCell(rowIndex, columnKey, nextValue)}
                        />
                      </td>
                    );
                  })}
                  {dynamicColumnKeys.map((columnKey) => {
                    const cellPath = `${path}.${rowIndex}.${columnKey}`;
                    return (
                      <td key={columnKey} className="px-3 py-2">
                        <TableCellField
                          path={cellPath}
                          value={row[columnKey] ?? missingValue}
                          onChange={(nextValue) => updateCell(rowIndex, columnKey, nextValue)}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <Verb
                      label="remove"
                      reason={`Drop row ${rowIndex + 1} from this table. The change lives in the form until save writes it.`}
                      onClick={() => field.remove(rowIndex)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {optionValues.length > 0 ? (
          <datalist id={datalistId}>
            {optionValues.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="">
          {primaryColumnOptions.isLoading
            ? "Loading table suggestions..."
            : "Schema-driven table with fixed and dynamic columns."}
        </span>
        <FieldOptionsMetadata options={primaryColumnOptions} />
        <div className="flex items-center gap-2">
          <Verb
            label="add column"
            reason="Add a dynamic column to this table. Every existing row gains the key, empty. The change lives in the form until save writes it."
            onClick={addColumn}
          />
          <Verb
            label="add row"
            reason="Append a row built from the schema's own defaults for this table. The change lives in the form until save writes it."
            onClick={addRow}
          />
        </div>
      </div>
    </div>
  );
}
