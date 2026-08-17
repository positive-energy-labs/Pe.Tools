import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import type { SchemaNodeRef } from "@pe/schema-core";
import {
  FieldChangeBadge,
  FieldLabelRow,
  FieldMessages,
  FieldOptionsMetadata,
} from "./field-metadata";
import {
  clearFieldServerErrors,
  formatFormError,
  type ResolvedFieldRendererProps,
  type SettingsFieldApi,
  useFieldOptions,
  useSettingsForm,
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
  form,
  path,
  value,
  onChange,
  list,
}: {
  form: ReturnType<typeof useSettingsForm>;
  path: string;
  value: unknown;
  onChange: (nextValue: string) => void;
  list?: string;
}) {
  return (
    <form.Field name={path as never}>
      {(field: SettingsFieldApi) => (
        <div className="space-y-1">
          <Input
            list={list}
            value={String(field.state.value ?? value ?? "")}
            onBlur={field.handleBlur}
            onChange={(event) => {
              clearFieldServerErrors(form, path);
              onChange(event.currentTarget.value);
            }}
            className={field.state.meta.errors.length > 0 ? "border-destructive" : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <FieldChangeBadge path={path} compact />
          </div>
          <FieldMessages messages={field.state.meta.errors.map(formatFormError)} compact />
        </div>
      )}
    </form.Field>
  );
}

export function TableField({ path, effectiveNodeRef, label }: ResolvedFieldRendererProps) {
  const form = useSettingsForm();
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

  return (
    <form.Field name={path as never}>
      {(field: SettingsFieldApi) => {
        const rows = Array.isArray(field.state.value) ? (field.state.value as TableRow[]) : [];
        const preferredDynamicColumns = uiMetadata?.behavior?.dynamicColumnOrder?.values ?? [];
        const observedDynamicColumns = collectObservedDynamicColumnKeys(rows, fixedColumnKeySet);
        const dynamicColumnKeys = mergeDynamicColumnKeys(
          preferredDynamicColumns,
          observedDynamicColumns,
        );
        const commitRows = (
          nextRows: TableRow[],
          nextDynamicColumns: string[] = dynamicColumnKeys,
        ) => {
          clearFieldServerErrors(form, path);
          field.handleChange(normalizeRows(nextRows, fixedColumnKeys, nextDynamicColumns) as never);
        };
        const updateCell = (rowIndex: number, columnKey: string, nextValue: string) => {
          const nextRows = rows.map((row, index) =>
            index === rowIndex ? { ...row, [columnKey]: nextValue } : row,
          );
          commitRows(nextRows);
        };
        const addColumn = () => {
          const nextColumnKeyBase = "NewType";
          let nextColumnKey = nextColumnKeyBase;
          let suffix = 1;
          const existingKeys = new Set([...fixedColumnKeys, ...dynamicColumnKeys]);

          while (existingKeys.has(nextColumnKey)) {
            suffix++;
            nextColumnKey = `${nextColumnKeyBase}${suffix}`;
          }

          const nextDynamicColumns = [...dynamicColumnKeys, nextColumnKey];
          if (rows.length === 0) {
            const nextRow = createRowTemplate(fixedColumns, nextDynamicColumns, missingValue);
            commitRows([nextRow], nextDynamicColumns);
            return;
          }

          const nextRows = rows.map((row) => ({
            ...row,
            [nextColumnKey]: missingValue,
          }));
          commitRows(nextRows, nextDynamicColumns);
        };
        const renameColumn = (columnKey: string, nextColumnKey: string) => {
          const trimmed = nextColumnKey.trim();
          if (
            trimmed.length === 0 ||
            trimmed === columnKey ||
            fixedColumnKeySet.has(trimmed) ||
            dynamicColumnKeys.includes(trimmed)
          ) {
            return;
          }

          const nextDynamicColumns = dynamicColumnKeys.map((key) =>
            key === columnKey ? trimmed : key,
          );
          const nextRows = rows.map((row) => {
            const renamed: TableRow = {};
            for (const [key, value] of Object.entries(row)) {
              renamed[key === columnKey ? trimmed : key] = value;
            }

            if (!(trimmed in renamed)) {
              renamed[trimmed] = missingValue;
            }

            return renamed;
          });
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            clearFieldServerErrors(form, `${path}.${rowIndex}.${columnKey}`);
          }
          commitRows(nextRows, nextDynamicColumns);
        };
        const removeColumn = (columnKey: string) => {
          const nextDynamicColumns = dynamicColumnKeys.filter((key) => key !== columnKey);
          const nextRows = rows.map((row) => {
            const { [columnKey]: _removed, ...rest } = row;
            return rest;
          });
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            clearFieldServerErrors(form, `${path}.${rowIndex}.${columnKey}`);
          }
          commitRows(nextRows, nextDynamicColumns);
        };
        const addRow = () => {
          const nextRow = createRowTemplate(fixedColumns, dynamicColumnKeys, missingValue);
          clearFieldServerErrors(form, path);
          field.pushValue(normalizeRowOrder(nextRow, fixedColumnKeys, dynamicColumnKeys) as never);
        };

        return (
          <div className="space-y-3">
            <FieldLabelRow
              label={label}
              required={effectiveNodeRef.isRequired()}
              description={description}
              defaultValue={defaultValue}
              path={path}
            />
            <FieldMessages messages={field.state.meta.errors.map(formatFormError)} />
            <div className="overflow-auto rounded-lg border border-border">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                            className="h-8 min-w-24 bg-background"
                          />
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => removeColumn(columnKey)}
                          >
                            Remove
                          </Button>
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
                        className="px-3 py-6 text-center text-sm text-muted-foreground"
                      >
                        No rows yet.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, rowIndex) => (
                      <tr key={`${path}.${rowIndex}`} className="border-t border-border align-top">
                        {fixedColumns.map(([columnKey], fixedColumnIndex) => {
                          const cellPath = `${path}.${rowIndex}.${columnKey}`;
                          return (
                            <td key={columnKey} className="px-3 py-2">
                              <TableCellField
                                form={form}
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
                                form={form}
                                path={cellPath}
                                value={row[columnKey] ?? missingValue}
                                onChange={(nextValue) => updateCell(rowIndex, columnKey, nextValue)}
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              clearFieldServerErrors(form, path);
                              field.removeValue(rowIndex);
                            }}
                          >
                            Remove
                          </Button>
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
              <span className="text-xs text-muted-foreground">
                {primaryColumnOptions.isLoading
                  ? "Loading table suggestions..."
                  : "Schema-driven table with fixed and dynamic columns."}
              </span>
              <FieldOptionsMetadata options={primaryColumnOptions} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={addColumn}>
                  Add column
                </Button>
                <Button type="button" variant="outline" onClick={addRow}>
                  Add row
                </Button>
              </div>
            </div>
          </div>
        );
      }}
    </form.Field>
  );
}
