import type { KeyboardEvent } from "react";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

import type { CellMove } from "#/components/master-table/cell-navigation";
import type { MasterTableState } from "#/components/master-table/model";

export const emptyTableState = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

export function toSortingState(sorts: MasterTableState["sorts"]): SortingState {
  return sorts.map((sort) => ({ id: sort.key, desc: sort.dir === "desc" }));
}

export function fromSortingState(sorting: SortingState): MasterTableState["sorts"] {
  return sorting.map((sort) => ({ key: sort.id, dir: sort.desc ? "desc" : "asc" }));
}

export function toColumnFiltersState(filters: MasterTableState["filters"]): ColumnFiltersState {
  return Object.entries(filters).map(([id, value]) => ({ id, value }));
}

export function fromColumnFiltersState(filters: ColumnFiltersState): MasterTableState["filters"] {
  return Object.fromEntries(filters.map((filter) => [filter.id, String(filter.value)]));
}

export function resolveUpdater<Value>(
  update: Value | ((previous: Value) => Value),
  previous: Value,
): Value {
  return typeof update === "function" ? (update as (previous: Value) => Value)(previous) : update;
}

export function keyDirection(key: string, shift: boolean): CellMove | null {
  if (key === "ArrowUp" || (key === "Enter" && shift)) return "up";
  if (key === "ArrowDown" || key === "Enter") return "down";
  if (key === "ArrowLeft" || (key === "Tab" && shift)) return "left";
  if (key === "ArrowRight" || key === "Tab") return "right";
  return null;
}

export function editCell(cell: HTMLTableCellElement, replacement?: string): boolean {
  const editor = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    // A hidden form proxy (base-ui renders one inside every Combobox) is never the editor.
    'input:not([disabled]):not([aria-hidden="true"]),textarea:not([disabled])',
  );
  if (!editor) {
    // A native select is edited by focusing it; its own typeahead and arrows take over.
    const select = cell.querySelector<HTMLSelectElement>("select:not([disabled])");
    if (select) {
      if (replacement !== undefined) return false;
      select.focus();
      return true;
    }
    // A button-shaped editor (a CellSelect's trigger) declares itself; editing it is opening it.
    const opener = cell.querySelector<HTMLButtonElement>("[data-cell-editor]:not([disabled])");
    if (!opener) return false;
    // A printable key opens a list editor already filtered by it; other editors ignore it.
    if (replacement !== undefined) {
      if (!opener.hasAttribute("data-cell-query")) return false;
      opener.dataset.query = replacement;
    }
    opener.click();
    return true;
  }
  editor.focus();
  if (replacement !== undefined) editor.value = replacement;
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
  return true;
}

export function isTypingKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export function isInteractive(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button,input,select,textarea,a,[role=button]") !== null
  );
}
