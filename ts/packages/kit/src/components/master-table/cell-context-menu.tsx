import { useContext, useEffect, useState } from "react";
import { ListPopup } from "../lang/list-popup";
import { ColumnQuery } from "./query-workbench";
import { clauseText, type QueryOp } from "./view";
import type { ResolvedColumn } from "./master-table-columns";
import { actionScopeKeys, invokeAction, type ActionDefinition, useScopeKeys } from "../../keys";
import { KeyHint } from "../lang/key-hint";
import { editCell } from "./master-table-state";
import { createTableActions } from "./table-actions";
import type { CellMove } from "./cell-navigation";

type Target<Row> = { row: Row; column: ResolvedColumn<Row>; cell: HTMLTableCellElement };
type Action = ActionDefinition & { key: string };

function MenuKeys({ actions, onDone }: { actions: readonly Action[]; onDone: () => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.querySelector<HTMLElement>('[data-list-popup][data-purpose="menu"]'));
  }, []);
  useScopeKeys(
    actionScopeKeys(
      actions.map((action) => ({
        ...action,
        invoke: (event) => {
          const handled = invokeAction(action, event);
          if (handled) onDone();
          return handled;
        },
      })),
    ),
    target,
  );
  return null;
}

/** One lazily mounted popup serves every cell in the body. */
export function CellContextMenu<Row>({
  target,
  moveFrom,
  copy,
}: {
  target: Target<Row> | null;
  moveFrom: (cell: HTMLElement, direction: CellMove, wrap?: boolean) => boolean;
  copy: (cell: HTMLTableCellElement) => boolean;
}) {
  const query = useContext(ColumnQuery);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(Boolean(target));
  }, [target]);
  if (!target) return null;
  const { row, column, cell } = target;
  const actions = createTableActions({
    getCell: () => (cell.isConnected ? cell : null),
    moveFrom,
    copy,
    edit: (current) => {
      setOpen(false);
      requestAnimationFrame(() => void editCell(current));
      return true;
    },
    openContext: () => false,
  }).filter(
    (action) =>
      (action.id === "table.copy-cell" || action.id === "table.edit-cell") &&
      action.available?.() !== false,
  ) as Action[];
  for (const action of actions) action.key = action.id;
  const field = query?.vocabulary.fields.find((item) => item.label === column.label);
  const kind = field?.kind;
  if (query && kind) {
    const value = column.condition?.read(row);
    const raw = value == null ? "" : String(value);
    const empty = raw.trim() === "";
    const conditions: [string, QueryOp, string][] = empty
      ? [
          ["is empty", "=", ""],
          ["is not empty", "!=", ""],
        ]
      : kind === "number"
        ? [
            ["is", "=", raw],
            ["at least", ">=", raw],
            ["at most", "<=", raw],
          ]
        : [
            ["is", "=", raw],
            ["is not", "!=", raw],
          ];
    for (const [label, op, valueText] of conditions)
      actions.push({
        id: `table.filter.${column.key}.${op}`,
        key: `filter:${op}:${valueText}`,
        label: `${column.label} ${label}${valueText ? ` ${column.condition?.labels?.get(valueText) ?? valueText}` : ""}`,
        invoke: () => {
          const clause = clauseText(false, column.label, op, valueText);
          query.onStateChange({
            ...query.state,
            query: [query.state.query.trim(), clause].filter(Boolean).join(" "),
          });
        },
      });
  }
  if (query && field?.sort)
    for (const dir of ["asc", "desc"] as const)
      actions.push({
        id: `table.sort.${dir}`,
        key: `sort:${dir}`,
        label: `Sort ${dir === "asc" ? "ascending" : "descending"}`,
        invoke: () =>
          query.onStateChange({
            ...query.state,
            sorts: [
              ...query.state.sorts.filter((item) => item.key !== field.sort),
              { key: field.sort!, dir },
            ],
          }),
      });
  return (
    <>
      {open && (
        <>
          <MenuKeys actions={actions} onDone={() => setOpen(false)} />
          <ListPopup<Action>
            anchor="caret"
            purpose="menu"
            caret={cell}
            open
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            aria-label={`${column.label} cell actions`}
            items={actions}
            keyOf={(item) => item.key}
            labelOf={(item) => item.label}
            filter="none"
            select="single"
            empty="no actions"
            footer={
              <details className="px-2 py-1">
                <summary className="cursor-pointer">Table keys</summary>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pt-1">
                  {createTableActions({
                    getCell: () => (cell.isConnected ? cell : null),
                    moveFrom,
                    copy,
                    edit: (current) => editCell(current),
                    openContext: () => false,
                  })
                    .filter((action) => action.available?.() !== false)
                    .flatMap((action) =>
                      (action.bindings ?? []).map((binding, index) => (
                        <div key={`${action.id}:${index}`} className="contents">
                          <dt>
                            <KeyHint hotkey={binding} />
                          </dt>
                          <dd>{action.description}</dd>
                        </div>
                      )),
                    )}
                </dl>
              </details>
            }
            row={(item) => ({
              label: item.label,
              meta: item.bindings?.map((binding, index) => (
                <KeyHint key={index} hotkey={binding} />
              )),
            })}
            onPick={(item) => {
              invokeAction(item);
              setOpen(false);
            }}
          />
        </>
      )}
    </>
  );
}
