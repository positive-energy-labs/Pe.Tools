import { describe, expect, it, vi } from "vite-plus/test";
import { actionScopeKeys } from "../src/keys";
import { createTableActions } from "../src/components/master-table/table-actions";

describe("table actions", () => {
  it("publishes stable cell navigation and lets native Tab exit at its edge", () => {
    const cell = {
      isConnected: true,
      querySelector: () => null,
    } as unknown as HTMLTableCellElement;
    const moveFrom = vi.fn((_cell: HTMLElement, direction: string) => direction !== "right");
    const actions = createTableActions({
      getCell: () => cell,
      moveFrom,
      copy: () => true,
      openContext: () => true,
      edit: () => true,
    });
    const keys = actionScopeKeys(actions);
    expect(keys.some((key) => key.actionId === "table.move-up" && key.hotkey === "ArrowUp")).toBe(
      true,
    );
    const tab = actions.find((action) => action.id === "table.next-cell")!;
    expect(tab.invoke()).toBe(false);
    const arrow = actions.find((action) => action.id === "table.move-up")!;
    expect(arrow.invoke()).toBe(true);
  });
});
