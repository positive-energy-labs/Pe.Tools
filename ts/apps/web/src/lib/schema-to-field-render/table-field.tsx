import { ActionButton } from "#/components/lang/action-button";
import { StateCell } from "#/components/lang/cell";
import { EmptyState } from "#/components/lang/empty";
import { Input } from "#/components/lang/input";
import { CellListSelect } from "#/components/lang/list-popup";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import type { SchemaNodeRef } from "@pe/schema-core";
import { FieldLabelRow, FieldMessages, FieldOptionsMetadata } from "./field-metadata";
import {
  primitiveInputValue,
  type ResolvedFieldRendererProps,
  useFieldChangeSummary,
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

/** One cell: the table's editable cell, marked unsaved when it differs from the saved value and
 * carrying its field's issues as the cell's refusal note. With suggestions it is the in-cell list,
 * whose typed text is still a value (the list's create row). */
function SchemaCell({
  path,
  value,
  onChange,
  suggestions,
}: {
  path: string;
  value: unknown;
  onChange: (nextValue: string) => void;
  suggestions?: readonly string[];
}) {
  const field = useSettingsField(path);
  const changed = useFieldChangeSummary(path) !== undefined;
  const text = primitiveInputValue(field.value ?? value);
  const issues = field.errors.map((issue) => issue.message).join("; ") || undefined;
  const facts = {
    value: text,
    stage: changed ? ("staged" as const) : ("clean" as const),
    stagedBy: "you" as const,
    scale: "row" as const,
  };
  if (!suggestions)
    return <StateCell {...facts} refused={issues} onCommit={(next) => onChange(next)} />;
  return (
    <CellListSelect<string>
      aria-label={path}
      value={text}
      display={<StateCell {...facts} />}
      invalid={issues !== undefined}
      title={issues}
      items={suggestions}
      keyOf={(suggestion) => suggestion}
      labelOf={(suggestion) => suggestion}
      row={(suggestion) => ({ label: suggestion })}
      select="single"
      selected={[text]}
      filter="substring"
      empty="no suggestions"
      createLabel={(typed) => `use "${typed}"`}
      onCreate={onChange}
      onPick={onChange}
    />
  );
}

type Line = { row: TableRow; index: number };

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
      <Table<Line>
        label={label}
        rows={rows.map((row, index) => ({ row, index }))}
        rowKey={(line) => `${path}.${line.index}`}
        maxHeight="28rem"
        empty={
          <EmptyState story="scope" exit="add row below">
            no rows yet
          </EmptyState>
        }
        columns={[
          ...fixedColumns.map(
            ([columnKey], fixedColumnIndex): Column<Line> => ({
              key: `fixed:${columnKey}`,
              label: columnKey,
              cell: ({ row, index }) => (
                <SchemaCell
                  path={`${path}.${index}.${columnKey}`}
                  value={row[columnKey]}
                  suggestions={
                    fixedColumnIndex === 0 && optionValues.length > 0 ? optionValues : undefined
                  }
                  onChange={(nextValue) => updateCell(index, columnKey, nextValue)}
                />
              ),
            }),
          ),
          ...dynamicColumnKeys.map(
            (columnKey): Column<Line> => ({
              key: `dynamic:${columnKey}`,
              label: columnKey,
              width: "min-w-36",
              header: (
                <span className="flex items-center gap-2 normal-case">
                  <Input
                    face="mono"
                    aria-label={`${columnKey} column name`}
                    defaultValue={columnKey}
                    onBlur={(event) => renameColumn(columnKey, event.currentTarget.value)}
                  />
                  <ActionButton
                    label="remove"
                    reason={`Drop the "${columnKey}" column from every row of this table. The change lives in the form until save writes it.`}
                    onClick={() => removeColumn(columnKey)}
                  />
                </span>
              ),
              cell: ({ row, index }) => (
                <SchemaCell
                  path={`${path}.${index}.${columnKey}`}
                  value={row[columnKey] ?? missingValue}
                  onChange={(nextValue) => updateCell(index, columnKey, nextValue)}
                />
              ),
            }),
          ),
          {
            key: "actions",
            label: "Actions",
            right: true,
            width: "w-24",
            cell: ({ index }) => (
              <ActionButton
                label="remove"
                reason={`Drop row ${index + 1} from this table. The change lives in the form until save writes it.`}
                onClick={() => field.remove(index)}
              />
            ),
          },
        ]}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="">
          {primaryColumnOptions.isLoading
            ? "Loading table suggestions..."
            : "Schema-driven table with fixed and dynamic columns."}
        </span>
        <FieldOptionsMetadata options={primaryColumnOptions} />
        <div className="flex items-center gap-2">
          <ActionButton
            label="add column"
            reason="Add a dynamic column to this table. Every existing row gains the key, empty. The change lives in the form until save writes it."
            onClick={addColumn}
          />
          <ActionButton
            label="add row"
            reason="Append a row built from the schema's own defaults for this table. The change lives in the form until save writes it."
            onClick={addRow}
          />
        </div>
      </div>
    </div>
  );
}
