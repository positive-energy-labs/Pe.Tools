import { describe, expect, it, vi } from "vite-plus/test";
import { actionScopeKeys, invokeAction, type ActionDefinition } from "../src/keys";

describe("action definitions", () => {
  it("uses one call-time availability gate for menus and scoped keys", () => {
    let available = true;
    const invoke = vi.fn();
    const action: ActionDefinition = {
      id: "table.edit",
      label: "Edit cell",
      description: "Edit the focused cell",
      bindings: ["Enter", "F2"],
      available: () => available,
      invoke,
    };
    const keys = actionScopeKeys([action]);
    expect(keys.map(({ hotkey, actionId }) => [hotkey, actionId])).toEqual([
      ["Enter", "table.edit"],
      ["F2", "table.edit"],
    ]);
    available = false;
    const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(invokeAction(action)).toBe(false);
    (keys[0]!.callback as (event: KeyboardEvent) => void)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    available = true;
    expect(invokeAction(action)).toBe(true);
    (keys[1]!.callback as (event: KeyboardEvent) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledTimes(2);
    action.refusal = "Read only";
    expect(invokeAction(action)).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
