/**
 * TABLE — the seed of the approved table reshape (`table-primitive-explainer.md`): the grid only.
 * Rows are the one `Row` (`as="tr"`), selection is `useCollection` (multi, shift-range over the
 * visible order), and each td is its cell's keyboard host (`CellHost`) with the table's
 * Enter/F2-edit and arrow/Tab moves. No frame, no search, no sort: those are wrappers and state.
 * ponytail: specimen-scale until the reshape moves MasterTable's routes onto it (wave 5).
 */
import { createRef, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { CellHost } from "#/components/lang/cell";
import { useCollection } from "#/components/lang/collection";
import { Row } from "#/components/lang/row";
import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import { editCell, isTypingKey, keyDirection } from "#/components/master-table/master-table-state";

export interface TableColumn<T> {
  key: string;
  label: string;
  width?: string;
  cell: (row: T) => ReactNode;
}

export function Table<T>({
  rows,
  rowKey,
  columns,
  selected,
  onSelectedChange,
  "aria-label": label,
}: {
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly TableColumn<T>[];
  selected?: readonly string[];
  onSelectedChange?: (keys: string[]) => void;
  "aria-label": string;
}) {
  const selection = useCollection<T>({
    items: rows,
    keyOf: rowKey,
    labelOf: rowKey,
    select: onSelectedChange ? "multi" : "none",
    selected,
    onSelectedChange,
    region: "table",
    // The cells own the keyboard here; the collection owns selection only.
    target: null,
  });
  const hosts = useRef(new Map<string, RefObject<HTMLTableCellElement | null>>());
  const hostOf = (id: string) => {
    let ref = hosts.current.get(id);
    if (!ref) hosts.current.set(id, (ref = createRef<HTMLTableCellElement>()));
    return ref;
  };
  const moveFrom = (from: Element, direction: CellMove): boolean => {
    const td = from.closest("td");
    const tr = td?.parentElement;
    if (!td || !tr) return false;
    const target =
      direction === "left"
        ? td.previousElementSibling
        : direction === "right"
          ? td.nextElementSibling
          : (direction === "up" ? tr.previousElementSibling : tr.nextElementSibling)?.children[
              td.cellIndex
            ];
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-cell")) return false;
    target.focus();
    return true;
  };
  const onKey = (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (event.target !== event.currentTarget) return;
    if ((event.key === "Enter" || event.key === "F2") && editCell(event.currentTarget))
      return event.preventDefault();
    if (isTypingKey(event) && editCell(event.currentTarget, event.key))
      return event.preventDefault();
    const direction = keyDirection(event.key, event.shiftKey);
    if (direction && moveFrom(event.currentTarget, direction)) event.preventDefault();
  };
  const multi = onSelectedChange != null;
  return (
    <table aria-label={label} role="grid" className="w-full border-collapse t-small">
      <thead>
        <tr className="hairline-b">
          {multi ? <th className="w-6" aria-label="select" /> : null}
          {columns.map((column) => (
            <th
              key={column.key}
              className={`px-(--item-pad-x) text-left t-upper ${column.width ?? ""}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const key = rowKey(row);
          const { onClick, selected: isSelected } = selection.rowProps(key);
          return (
            <Row as="tr" key={key} data-key={key} selected={multi ? isSelected : undefined}>
              {multi ? (
                <td className="hairline-b-inset w-6 text-center">
                  <input
                    type="checkbox"
                    aria-label={`select ${key}`}
                    checked={Boolean(isSelected)}
                    // Shift extends over the visible order, like a list.
                    onClick={(event) => onClick({ shiftKey: event.shiftKey })}
                    onChange={() => {}}
                  />
                </td>
              ) : null}
              {columns.map((column, columnIndex) => {
                const id = `${key}:${column.key}`;
                return (
                  <td
                    key={column.key}
                    ref={hostOf(id)}
                    data-cell=""
                    // The table's one tab stop is its first cell; arrows and Tab move from there.
                    tabIndex={rowIndex === 0 && columnIndex === 0 ? 0 : -1}
                    onKeyDown={onKey}
                    className="hairline-b-inset p-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-2"
                  >
                    <CellNavigationProvider
                      move={(direction) =>
                        document.activeElement instanceof HTMLElement &&
                        moveFrom(document.activeElement, direction)
                      }
                    >
                      <CellHost.Provider value={hostOf(id)}>{column.cell(row)}</CellHost.Provider>
                    </CellNavigationProvider>
                  </td>
                );
              })}
            </Row>
          );
        })}
      </tbody>
    </table>
  );
}
