// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KeyScope, readKeyMeta, readRegistrations, useScopeKeys } from "@pe/kit/keys";
import { TableFrame } from "./table-frame";

afterEach(cleanup);

test("TableFrame reserves F for its enclosing stage and advertises Shift+F for filters", () => {
  const frame = vi.fn();
  function StageKeys() {
    useScopeKeys([{ hotkey: "F", label: "Frame selection", callback: frame }]);
    return null;
  }
  const view = render(
    <KeyScope id="table-test">
      <StageKeys />
      <TableFrame
        label="test table"
        rows={[]}
        columns={[]}
        rowKey={() => ""}
        state={{ query: "", sorts: [] }}
        onStateChange={vi.fn()}
        query={{
          fields: [{ label: "Name", kind: "text" }],
          rules: [],
          count: () => 0,
          values: () => [],
        }}
        summary="a long summary"
      >
        <button>row target</button>
      </TableFrame>
    </KeyScope>,
  );
  const trigger = screen.getByRole("button", { name: "Filters" });
  expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Shift+F");
  const target = screen.getByRole("button", { name: "row target" });
  const clicked = vi.fn();
  trigger.addEventListener("click", clicked);
  target.focus();
  fireEvent.keyDown(target, { key: "f", code: "KeyF" });
  expect(frame).toHaveBeenCalledOnce();
  expect(clicked).not.toHaveBeenCalled();
  fireEvent.keyDown(target, { key: "F", code: "KeyF", shiftKey: true });
  expect(clicked).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledOnce();
  const action = readRegistrations().find(
    (entry) => readKeyMeta(entry.options.meta)?.actionId === "table.filters",
  );
  expect(action?.hotkey).toBe("Shift+F");
  expect(screen.getByText("a long summary").className).toContain("min-w-0");
  expect(view.container.querySelector('[data-slot="artifact-frame"]')?.className).toContain(
    "flex-1",
  );
});
