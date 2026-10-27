// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { RulesTree } from "./rules-pane";

vi.mock("./rules", () => ({
  Chips: () => <input aria-label="table cell" />,
  DropCell: () => <input aria-label="drop cell" />,
  StagedRules: () => null,
}));
afterEach(cleanup);

test("rule rows keep native ids and editable cells keep their arrow and Enter keys", () => {
  const onFocus = vi.fn();
  const snapshot = { nodes: [], segments: [], groups: [] } as unknown as DuctSnapshot;
  const result = {
    paths: {
      20: {
        rows: [
          { id: 20, rule: "elbow-mitered" },
          { id: 40, finding: "no-rule", family: "Unassigned" },
        ],
      },
    },
  };
  const priced = {
    snapshot,
    now: result,
    next: result,
    edit: { componentDrops: { 30: {} }, ruleAssignments: {} },
  } as unknown as Priced;
  render(
    <RulesTree
      snapshot={snapshot}
      priced={priced}
      groups={[]}
      wide
      work={{ doc: ductsDocumentSchema.parse({}), revision: null, write: vi.fn() }}
      focus={null}
      onFocus={onFocus}
      nameOf={(id) => `Fitting ${id}`}
    />,
  );
  const row = document.querySelector('[data-key="elbow-mitered"]')!;
  expect(row.getAttribute("data-revit-ids")).toBe("20");
  const input = screen.getByRole("textbox", { name: "table cell" });
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onFocus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  fireEvent.click(row);
  expect(onFocus).toHaveBeenCalledWith("elbow-mitered");
  expect(document.querySelector('[data-key="o30"]')?.getAttribute("data-revit-ids")).toBe("30");
  expect(document.querySelector('[data-e-unruled-ids~="40"] input')).toBeTruthy();
});
