import { elementSubject } from "@pe/ducts-domain/work-subject";
// @vitest-environment jsdom
import { designOf } from "@pe/ducts-domain/test-design";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Priced } from "@pe/ducts-web/priced";
import { calcOf, legOf } from "@pe/ducts-web/calcs.test-support";
import { nodeOf, snapshotOf } from "@pe/ducts-domain/test-snapshot";
import { RulesTree } from "./rules-pane.tsx";

vi.mock("./rules.tsx", () => ({
  Chips: () => <input aria-label="table cell" />,
  DropCell: () => <input aria-label="drop cell" />,
  StagedRules: () => null,
}));
afterEach(cleanup);

test("rule rows keep native ids and editable cells keep their arrow and Enter keys", () => {
  const onFocus = vi.fn();
  const snapshot = snapshotOf({ nodes: [20, 30, 40].map((id) => nodeOf(id, "fitting")) });
  // One fan calc whose path to grille 99 carries a ruled elbow and a fitting no rule matches.
  const calc = calcOf(
    1,
    [legOf("20:1>2", 20, "fitting", 0.1), legOf("40:1>2", 40, "fitting", null)],
    [{ terminal: 99, legIds: ["20:1>2", "40:1>2"] }],
  );
  calc.fittings = [
    { key: "20", elementId: 20, family: "Elbow", rule: "elbow-mitered", ruleSource: "matched", lossInWg: 0.1 },
    { key: "40", elementId: 40, family: "Unassigned", rule: null, ruleSource: "none", lossInWg: null },
  ] as never;
  const priced = {
    snapshot,
    calcs: [calc],
    edit: { componentDrops: { [elementSubject(snapshot.nodes.find(node => node.id === 30)!)]: {} }, ruleAssignments: {} },
  } as unknown as Priced;
  render(
    <RulesTree
      snapshot={snapshot}
      priced={priced}
      groups={[]}
      wide
      work={{ doc: designOf({}), revision: null, write: vi.fn() }}
      focus={null}
      onFocus={onFocus}
      nameOf={(id) => `Fitting ${id}`}
    />,
  );
  const row = document.querySelector('[data-key="elbow-mitered"]')!;
  expect(row.getAttribute("data-revit-ids")).toBe("20");
  // The fan-out is counted from the fan calcs' paths: one grille's path carries the elbow.
  expect(document.querySelector('[data-e-fanout="elbow-mitered"]')?.textContent).toContain("moves 1 grille");
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
