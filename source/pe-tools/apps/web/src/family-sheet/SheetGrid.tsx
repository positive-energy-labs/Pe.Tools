import { type Dispatch, Fragment, type SetStateAction, useMemo } from "react";

import { type FamilySheetParam, formulaCellKey, worksheetCellKey } from "@pe/agent-contracts";

import { type CellFocus, SheetCell } from "#/family-sheet/SheetCell";
import { useFamilySheet } from "#/family-sheet/store";

/** Group parameters by `param.group` (Revit-dialog style), preserving order. */
function groupParams(params: FamilySheetParam[]): [string, FamilySheetParam[]][] {
  const order: string[] = [];
  const byGroup = new Map<string, FamilySheetParam[]>();
  for (const p of params) {
    const g = p.group ?? "Other";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g)!.push(p);
  }
  return order.map((g) => [g, byGroup.get(g)!]);
}

/**
 * The left pane: parameters × types, grouped like Revit's Family Types dialog.
 * Columns = Parameter | Formula | one per type. The formula column is a real
 * `@formula` cell; type cells are `param::type`.
 */
export function SheetGrid({
  focus,
  setFocus,
}: {
  focus: CellFocus | null;
  setFocus: Dispatch<SetStateAction<CellFocus | null>>;
}) {
  const { worksheet } = useFamilySheet();
  const snapshot = worksheet.snapshot;
  const groups = useMemo(() => groupParams(snapshot?.parameters ?? []), [snapshot?.parameters]);

  if (!snapshot) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        no family read — click “Read family”.
      </div>
    );
  }

  const types = snapshot.typeNames;
  const colCount = 2 + types.length;

  const focusCell = (key: string, pinned: boolean) => setFocus({ key, pinned });
  const blurCell = (key: string) => {
    // only clear on hover-out when this focus isn't pinned
    setFocus((f) => (f && f.key === key && !f.pinned ? null : f));
  };

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-[var(--paper)]">
          <tr className="border-b border-[var(--line-2)] text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="w-[220px] px-2 py-1.5">Parameter</th>
            <th className="w-[160px] border-l border-[var(--line-soft)] px-2 py-1.5">Formula</th>
            {types.map((t) => (
              <th
                key={t}
                className="border-l border-[var(--line-soft)] px-2 py-1.5 whitespace-nowrap"
              >
                {t}
                {snapshot.currentTypeName === t && (
                  <span className="ml-1 text-[var(--pe-green)]" title="current type">
                    ●
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, params]) => (
            <Fragment key={group}>
              <tr>
                <td
                  colSpan={colCount}
                  className="border-b border-[var(--line)] bg-[var(--paper-2)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group}
                </td>
              </tr>
              {params.map((param) => (
                <ParamRow
                  key={param.name}
                  param={param}
                  types={types}
                  focusKey={focus?.key ?? null}
                  onFocus={focusCell}
                  onBlur={blurCell}
                  setFocus={setFocus}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParamRow({
  param,
  types,
  focusKey,
  onFocus,
  onBlur,
  setFocus,
}: {
  param: FamilySheetParam;
  types: string[];
  focusKey: string | null;
  onFocus: (key: string, pinned: boolean) => void;
  onBlur: (key: string) => void;
  setFocus: Dispatch<SetStateAction<CellFocus | null>>;
}) {
  const { worksheet } = useFamilySheet();
  const cells = worksheet.cells;
  const formulaKey = formulaCellKey(param.name);
  const formulaDetermined = param.isDeterminedByFormula ?? false;

  return (
    <tr className="hover:bg-[color-mix(in_srgb,var(--foreground)_2%,transparent)]">
      {/* parameter name + caption */}
      <td className="h-8 border-b border-[var(--line-soft)] px-2 align-middle">
        <div className="flex items-center gap-1.5">
          <span className="truncate whitespace-nowrap text-[13px] font-medium" title={param.name}>
            {param.name}
          </span>
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {param.isInstance ? "inst" : "type"}
          </span>
        </div>
      </td>

      {/* formula column — a real @formula cell */}
      <SheetCell
        cellKey={formulaKey}
        snapshotValue={param.formula ?? ""}
        cell={cells[formulaKey]}
        readOnly={false}
        focused={focusKey === formulaKey}
        onFocus={() => onFocus(formulaKey, false)}
        onBlur={() => onBlur(formulaKey)}
        onPin={() => setFocus({ key: formulaKey, pinned: true })}
      />

      {/* one value cell per type */}
      {types.map((typeName) => {
        const key = worksheetCellKey(param.name, typeName);
        return (
          <SheetCell
            key={key}
            cellKey={key}
            snapshotValue={param.valuesPerType[typeName] ?? ""}
            cell={cells[key]}
            readOnly={param.isReadOnly || formulaDetermined}
            focused={focusKey === key}
            onFocus={() => onFocus(key, false)}
            onBlur={() => onBlur(key)}
            onPin={() => setFocus({ key, pinned: true })}
          />
        );
      })}
    </tr>
  );
}
