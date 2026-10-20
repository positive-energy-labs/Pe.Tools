import { CELL_EDITOR } from "./master-table-state";
import type { CellMove } from "./cell-navigation";
import type { ActionDefinition, Chord } from "../../keys";

export interface TableActionContext {
  getCell: () => HTMLTableCellElement | null;
  moveFrom: (cell: HTMLElement, direction: CellMove, wrap?: boolean) => boolean;
  copy: (cell: HTMLTableCellElement) => boolean;
  openContext: (cell: HTMLTableCellElement) => boolean;
  edit: (cell: HTMLTableCellElement) => boolean;
}

export const canEditCell = (cell: HTMLTableCellElement | null): cell is HTMLTableCellElement =>
  Boolean(
    cell?.isConnected &&
    cell.querySelector(
      `${CELL_EDITOR},select:not([disabled]),button[data-cell-editor]:not([disabled])`,
    ),
  );

export const cellCopyText = (cell: HTMLTableCellElement, fallback: string): string => {
  const editor = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>(CELL_EDITOR);
  if (editor) return editor.value;
  const select = cell.querySelector<HTMLSelectElement>("select:not([disabled])");
  if (select) return select.selectedOptions[0]?.label ?? select.value;
  const opener = cell.querySelector<HTMLButtonElement>("button[data-cell-editor]");
  return opener?.textContent?.trim() || fallback;
};

/** One table action set feeds the grid bindings and the cell menu. */
export function createTableActions(context: TableActionContext): ActionDefinition[] {
  const cell = () => context.getCell();
  const navigate = (
    id: string,
    label: string,
    bindings: readonly Chord[],
    direction: CellMove,
    wrap = false,
  ): ActionDefinition => ({
    id: `table.${id}`,
    label,
    description: label,
    bindings,
    invoke: () => {
      const target = cell();
      if (!target) return false;
      const moved = context.moveFrom(target, direction, wrap);
      return moved || !wrap;
    },
  });
  const edit: ActionDefinition = {
    id: "table.edit-cell",
    label: "Edit cell",
    description: "Open the focused cell editor",
    bindings: canEditCell(cell()) ? ["Enter", "F2"] : ["F2"],
    available: () => canEditCell(cell()),
    invoke: () => {
      const target = cell();
      return canEditCell(target) ? context.edit(target) : false;
    },
  };
  const copy: ActionDefinition = {
    id: "table.copy-cell",
    label: "Copy cell",
    description: "Copy the cell value",
    bindings: ["Mod+C"],
    available: () => Boolean(cell()?.isConnected),
    invoke: () => {
      const target = cell();
      if (!target) return false;
      return context.copy(target);
    },
  };
  const contextMenu: ActionDefinition = {
    id: "table.cell-menu",
    label: "Open cell actions",
    description: "Open actions for the focused cell",
    bindings: [{ key: "ContextMenu" }, "Shift+F10"],
    available: () => Boolean(cell()?.isConnected),
    invoke: () => {
      const target = cell();
      return target ? context.openContext(target) : false;
    },
  };
  return [
    navigate("move-up", "Move cell up", ["ArrowUp", "Shift+Enter"], "up"),
    navigate(
      "move-down",
      "Move cell down",
      canEditCell(cell()) ? ["ArrowDown"] : ["ArrowDown", "Enter"],
      "down",
    ),
    navigate("move-left", "Move cell left", ["ArrowLeft"], "left"),
    navigate("move-right", "Move cell right", ["ArrowRight"], "right"),
    navigate("previous-cell", "Previous cell", ["Shift+Tab"], "left", true),
    navigate("next-cell", "Next cell", ["Tab"], "right", true),
    edit,
    copy,
    contextMenu,
  ];
}
