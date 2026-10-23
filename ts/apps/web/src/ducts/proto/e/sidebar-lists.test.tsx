import { emptyListSearch, pickListPill } from "@pe/agent-contracts";
const search = (keywords = "", pills: Record<string, string> = {}) =>
  Object.entries(pills).reduce((s, [field, value]) => pickListPill(s, field, value), {
    ...emptyListSearch(),
    keywords,
  });
// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useReachChannel } from "@pe/kit/lang/reach";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { FanResult } from "@pe/ducts-domain/losses";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { readGestures } from "@pe/kit/keys";
import { NativeObservationScope } from "#/revit/observation";
import type { TreeNode } from "../b/model";
import { SystemTree, type TreeCtx } from "./tree-sidebar";
import { InputsPane, type InputsPaneProps } from "./inputs-pane";
import { fanFacts } from "./fan-sections";

// Cell fixtures exercise the sidebar's event boundary; the Work cell implementations stay unchanged.
vi.mock("./input-cells", () => ({
  EquipmentCells: ({ id }: { id: number }) => <input aria-label={`unit cell ${id}`} />,
  TerminalCells: ({ id }: { id: number }) => <input aria-label={`grille cell ${id}`} />,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const node = (
  key: string,
  kind: TreeNode["kind"],
  id: number,
  children: TreeNode[] = [],
): TreeNode => ({
  key,
  kind,
  id,
  name: key,
  children,
  terminal: kind === "run" ? id : null,
  total: 1,
  self: 0.1,
  ft: 10,
  selfFt: 2,
  rate: null,
  unpriced: null,
  split: null,
  scale: 1,
  critical: null,
  provisional: null,
  level: null,
});
const trees = [
  node("system", "system", 1, [
    node("Z critical", "run", 100, [node("leg10", "leg", 10, [node("part10", "element", 10)])]),
    node("A other", "run", 200, [node("leg20", "leg", 20, [node("part20", "element", 20)])]),
  ]),
];
const context = (over: Partial<TreeCtx> = {}): TreeCtx => ({
  trees,
  criticalKey: "Z critical",
  selected: null,
  scale: 1,
  grilleName: (row) => row.name,
  ruleOf: new Map([[20, "rule20"]]),
  light: vi.fn(),
  select: vi.fn(),
  jumpToRule: vi.fn(),
  reading: null,
  designRate: 0.08,
  ...over,
});
const keyed = (key: string) => document.querySelector<HTMLElement>(`[data-key="${key}"]`)!;

test("typing in a large tree reuses its name index instead of renaming every hidden run", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const grilleName = vi.fn((row: TreeNode) => row.name);
  const runs = Array.from({ length: 1000 }, (_, i) => node(`run${i}`, "run", i + 100));
  render(<SystemTree ctx={context({ trees: [node("system", "system", 1, runs)], grilleName })} />);
  grilleName.mockClear();
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox", { name: "Search system tree" }), {
      target: { value: "no matching run" },
    });
  });
  expect(grilleName.mock.calls.length).toBeLessThan(100);
  vi.unstubAllGlobals();
});
const toggle = (key: string) => fireEvent.click(keyed(key).querySelector(".dl-row-twist")!);

test("critical context opens initially; one selected part reveals, retains native refs, hover and rule jump", () => {
  const ctx = context({ selected: 20 });
  const ref = { elementId: 20, uniqueId: "part-twenty", documentKey: "model" };
  render(
    <NativeObservationScope value={{ scope: null, references: [ref] }}>
      <SystemTree ctx={ctx} />
    </NativeObservationScope>,
  );
  expect(keyed("Z critical").getAttribute("aria-expanded")).toBe("true");
  expect(keyed("Z critical").textContent).toContain("\u25c6");
  expect(keyed("A other").getAttribute("aria-expanded")).toBe("true");
  expect(keyed("part20").getAttribute("aria-selected")).toBe("true");
  expect(keyed("part20").hasAttribute("data-landed")).toBe(true);
  expect(
    screen.getAllByRole("treeitem").filter((row) => row.getAttribute("aria-selected") === "true"),
  ).toHaveLength(1);
  expect(JSON.parse(keyed("part20").getAttribute("data-revit-refs")!)).toEqual([ref]);
  expect(document.querySelector("[data-tree-columns]")).not.toBeNull();
  expect(screen.getByRole("tree").getAttribute("aria-activedescendant")).toBe(keyed("part20").id);
  fireEvent.mouseEnter(keyed("part20"));
  expect(ctx.light).toHaveBeenLastCalledWith([20]);
  fireEvent.click(within(keyed("part20")).getByRole("button", { name: "jump to its type's rule" }));
  expect(ctx.jumpToRule).toHaveBeenCalledWith("rule20");
  expect(ctx.select).not.toHaveBeenCalled();
  fireEvent.click(keyed("part20"));
  expect(ctx.select).toHaveBeenCalledWith(20);
});

test("manual expansion survives selection elsewhere and the list owns tree keyboard navigation", () => {
  const ctx = context({ selected: 20 });
  const view = render(<SystemTree ctx={ctx} />);
  toggle("A other");
  expect(document.querySelector('[data-key="part20"]')).toBeNull();
  view.rerender(<SystemTree ctx={{ ...ctx, selected: 10 }} />);
  expect(keyed("A other").getAttribute("aria-expanded")).toBe("false");
  expect(keyed("part10").getAttribute("aria-selected")).toBe("true");
  const tree = screen.getByRole("tree");
  tree.focus();
  fireEvent.keyDown(tree, { key: "ArrowLeft" });
  expect(tree.getAttribute("aria-activedescendant")).toBe(keyed("leg10").id);
});

test("address query and name sort round trip; revealing an excluded selection never clears authored grammar", async () => {
  const changed = vi.fn();
  function AddressTree({ selected = 20 }: { selected?: number }) {
    const [query, setQuery] = useState(search("10", { kind: "element" }));
    const [sort, setSort] = useState<"" | "name">("name");
    return (
      <SystemTree
        ctx={context({ selected })}
        address={{
          search: query,
          sort,
          onChange: (q, s) => {
            changed(q, s);
            setQuery(q);
            setSort(s);
          },
        }}
      />
    );
  }
  const view = render(<AddressTree />);
  const input = screen.getByRole("combobox", { name: "Search system tree" });
  expect(input.getAttribute("value")).toBe("10");
  expect(document.querySelector('[data-key="part20"]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  view.rerender(<AddressTree selected={10} />);
  expect(keyed("part10").getAttribute("aria-selected")).toBe("true");
  expect(input.getAttribute("value")).toBe("10");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(search(), "name"));
  const runs = screen
    .getAllByRole("treeitem")
    .filter((row) => row.querySelector('[data-e-kind="run"]'));
  expect(runs.map((row) => row.getAttribute("data-key"))).toEqual(["A other", "Z critical"]);
});

const inputs = (over: Partial<InputsPaneProps> = {}): InputsPaneProps => ({
  snapshot: {
    nodes: [
      { id: 1, kind: "equipment" },
      { id: 20, kind: "terminal" },
      { id: 10, kind: "terminal" },
    ],
  } as DuctSnapshot,
  priced: {} as Priced,
  work: { doc: null, revision: 4, write: vi.fn(async () => null) },
  scope: { groups: [], units: new Set([1]), terminals: new Set([10, 20]) },
  nameOf: (id) => `Name ${id}`,
  selected: null,
  select: vi.fn(),
  ...over,
});

test("inputs preserve scoped order and selection, while editing and fan verbs stay isolated from list activation", () => {
  const reach = renderHook(() => useReachChannel()).result.current;
  const verb = vi.fn();
  const props = inputs({ selected: 20, fanVerbs: () => <button onClick={verb}>make fan</button> });
  render(<InputsPane {...props} />);
  expect(screen.getAllByRole("option").map((row) => row.getAttribute("data-key"))).toEqual([
    "unit:1",
    "grille:20",
    "grille:10",
  ]);
  expect(keyed("grille:20").getAttribute("aria-selected")).toBe("true");
  expect(readGestures()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ keys: ["Enter"], label: "commit, next row" }),
      expect.objectContaining({ keys: ["Tab"], label: "commit, next cell" }),
      expect.objectContaining({ keys: ["Esc"], label: "drop the typed value" }),
      expect.objectContaining({ pointer: "click", label: "select in the picture" }),
    ]),
  );
  const cell = screen.getByRole("textbox", { name: "unit cell 1" });
  cell.focus();
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: "ArrowDown" });
  fireEvent.keyDown(cell, { key: "Enter" });
  fireEvent.keyDown(cell, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "make fan" }));
  expect(verb).toHaveBeenCalledOnce();
  expect(props.select).not.toHaveBeenCalled();
  fireEvent.click(within(keyed("unit:1")).getByText("Name 1"));
  expect(props.select).toHaveBeenCalledWith(1);
  fireEvent.mouseEnter(keyed("grille:10"));
  expect(reach.get().hovered).toBe(10);
  fireEvent.mouseLeave(keyed("grille:10"));
  expect(reach.get().hovered).toBeNull();
});

test("inputs use address grammar/name order and retain the unpriced waiting state", async () => {
  const changed = vi.fn();
  const props = inputs({
    selected: 20,
    address: { search: search("", { kind: "grille" }), sort: "name", onChange: changed },
  });
  const view = render(<InputsPane {...props} />);
  expect(screen.getAllByRole("option").map((row) => row.getAttribute("data-key"))).toEqual([
    "grille:10",
    "grille:20",
  ]);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Search inputs" }), {
    target: { value: "10" },
  });
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith(search("10", { kind: "grille" }), "name"),
  );
  view.rerender(<InputsPane {...inputs({ priced: null })} />);
  expect(
    screen.getByText("flow, ESP and role cells open once the loss tables are read"),
  ).toBeTruthy();
  expect(screen.queryByRole("listbox")).toBeNull();
});

const fan = (unit: number, critical: number | null, cfm: number): FanResult => ({
  unit,
  cfm,
  critical,
  port: unit,
  junction: null,
  owned: [unit, unit + 1],
  esp: 0.125,
  tel: 12,
  stretch: [],
  viaJunction: false,
  path: [],
  rows: [],
});
test("fan facts keep largest-first order, name the trunk owner and where a smaller fan ends", () => {
  const priced = {
    next: { byGroup: { g: { fans: [fan(1, 20, 400), { ...fan(2, null, 200), junction: 9 }] } } },
  } as unknown as Priced;
  const facts = fanFacts(priced, ["g"], (id) => `E${id}`);
  expect(facts.map((f) => [f.unit, f.role])).toEqual([
    [1, "largest fan"],
    [2, "fan"],
  ]);
  expect(facts[0]!.says).toBe("400 cfm · TEL 12 ft · ESP 0.125 in-wg · owns the trunk");
  expect(facts[1]!.says).toMatch(/ · to E9$/);
  // A lone fan carries no section words.
  expect(fanFacts(priced, [], String)).toEqual([]);
});
