import { type Dispatch, Fragment, type SetStateAction, useCallback, useMemo } from "react";

import { type FamilyTypesParam, cellKey, formulaCellKey } from "@pe/agent-contracts";

import { type CellFocus, Cell } from "#/family-types/Cell";
import { type FormulaProblem, validateFormula } from "#/family-types/formula";
import { useFamilyTypes } from "#/family-types/store";
import { cn } from "#/lib/utils";

/** Group parameters by `param.group` (Revit-dialog style), preserving first-seen order. */
function groupParams(params: FamilyTypesParam[]): [string, FamilyTypesParam[]][] {
  const order: string[] = [];
  const byGroup = new Map<string, FamilyTypesParam[]>();
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
 * The center-left pane: parameters × types, grouped like Revit's Family Types
 * dialog. Columns = Parameter | Formula | one per type. The formula column is a
 * real `@formula` cell with live validation; type cells are `param::type`.
 * Clicking a parameter name selects it for the inspector.
 */
export function Grid({
  focus,
  setFocus,
  selected,
  onSelect,
}: {
  focus: CellFocus | null;
  setFocus: Dispatch<SetStateAction<CellFocus | null>>;
  selected: string | null;
  onSelect: (paramName: string) => void;
}) {
  const { document } = useFamilyTypes();
  const snapshot = document.snapshot;
  const params = snapshot?.parameters ?? [];
  const groups = useMemo(() => groupParams(params), [params]);

  // One validator closed over the current snapshot params — passed to formula cells.
  const validateFor = useCallback(
    (paramName: string) =>
      (draft: string): FormulaProblem[] =>
        validateFormula({ paramName, draft, params }),
    [params],
  );

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
  const blurCell = (key: string) => setFocus((f) => (f && f.key === key && !f.pinned ? null : f));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-[var(--paper)]">
          <tr className="border-b border-[var(--line-2)] text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 z-10 w-[220px] bg-[var(--paper)] px-2 py-1.5">
              Parameter
            </th>
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
          {groups.map(([group, groupParamList]) => (
            <Fragment key={group}>
              <tr>
                <td
                  colSpan={colCount}
                  className="border-b border-[var(--line)] bg-[var(--paper-2)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group}
                </td>
              </tr>
              {groupParamList.map((param) => (
                <ParamRow
                  key={param.name}
                  param={param}
                  types={types}
                  focusKey={focus?.key ?? null}
                  selected={selected === param.name}
                  onSelect={onSelect}
                  onFocus={focusCell}
                  onBlur={blurCell}
                  setFocus={setFocus}
                  validate={validateFor(param.name)}
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
  selected,
  onSelect,
  onFocus,
  onBlur,
  setFocus,
  validate,
}: {
  param: FamilyTypesParam;
  types: string[];
  focusKey: string | null;
  selected: boolean;
  onSelect: (paramName: string) => void;
  onFocus: (key: string, pinned: boolean) => void;
  onBlur: (key: string) => void;
  setFocus: Dispatch<SetStateAction<CellFocus | null>>;
  validate: (draft: string) => FormulaProblem[];
}) {
  const { document } = useFamilyTypes();
  const cells = document.cells;
  const formulaKey = formulaCellKey(param.name);
  const formulaDetermined = param.isDeterminedByFormula ?? false;
  const hasAncestry =
    !!param.dependsOn?.length ||
    !!param.dependents?.length ||
    !!(
      param.associations &&
      (param.associations.dimensions.length ||
        param.associations.arrays.length ||
        param.associations.nested.length)
    );

  return (
    <tr className="hover:bg-[color-mix(in_srgb,var(--foreground)_2%,transparent)]">
      {/* parameter name + caption — click to select for the inspector */}
      <td
        className={cn(
          "sticky left-0 z-[1] h-8 cursor-pointer border-b border-[var(--line-soft)] bg-[var(--paper)] px-2 align-middle",
          selected && "bg-[color-mix(in_srgb,var(--pe-blue)_12%,var(--paper))]",
        )}
        onClick={() => onSelect(param.name)}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate whitespace-nowrap text-[13px] font-medium",
              selected && "text-[var(--pe-blue)]",
            )}
            title={param.name}
          >
            {param.name}
          </span>
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">
            {param.isInstance ? "inst" : "type"}
          </span>
          {hasAncestry && (
            <span
              className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--pe-blue)]/50"
              title="has dependencies / associations"
            />
          )}
        </div>
      </td>

      {/* formula column — a real @formula cell with live validation */}
      <Cell
        cellKey={formulaKey}
        snapshotValue={param.formula ?? ""}
        cell={cells[formulaKey]}
        readOnly={false}
        focused={focusKey === formulaKey}
        onFocus={() => onFocus(formulaKey, false)}
        onBlur={() => onBlur(formulaKey)}
        onPin={() => setFocus({ key: formulaKey, pinned: true })}
        validate={validate}
        formulaParamName={param.name}
      />

      {/* one value cell per type */}
      {types.map((typeName) => {
        const key = cellKey(param.name, typeName);
        return (
          <Cell
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
