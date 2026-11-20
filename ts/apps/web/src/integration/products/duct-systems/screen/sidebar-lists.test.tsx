import { emptyListSearch, pickListPill } from "@pe/agent-contracts";
const search = (keywords = "", pills: Record<string, string> = {}) =>
  Object.entries(pills).reduce((s, [field, value]) => pickListPill(s, field, value), {
    ...emptyListSearch(),
    keywords,
  });
// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makeAtomRegistry } from "../../../../shell/owner.ts";
import { TestAttention, eKey } from "../../../../test-attention.tsx";
import { hovered } from "@pe/kit/lang/attention";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Priced } from "@pe/ducts-web/priced";
import { calcOf, legOf, pricedOf } from "@pe/ducts-web/calcs.test-support";
import { NativeObservationScope } from "@pe/web-kernel/revit/observation";
import type { TreeNode } from "../../../../../../../products/duct-systems/web/src/network/model.ts";
import { SystemTree, type TreeCtx } from "../../../../../../../products/duct-systems/web/src/screen/tree-sidebar.tsx";
import { fanFacts } from "../../../../../../../products/duct-systems/web/src/screen/fan-sections.tsx";
import { runOf } from "../../../../../../../products/duct-systems/web/src/screen/run-detail.tsx";
import { Scroll } from "@pe/kit/lang/scroll";

const derivations = vi.hoisted(() => ({ count: 0, all: null as unknown }));
vi.mock("@pe/kit/lang/collection", async (original) => {
  const actual = await original<typeof import("@pe/kit/lang/collection")>();
  return {
    ...actual,
    useList: ((options: Parameters<typeof actual.useList>[0]) => {
      const list = actual.useList(options);
      if (list.all !== derivations.all) {
        derivations.count++;
        derivations.all = list.all;
      }
      return list;
    }) as typeof actual.useList,
  };
});

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

test("hovering an expanded 3606-row system tree never re-derives its list", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  const trees = Array.from({ length: 6 }, (_, group) =>
    node(
      `system${group}`,
      "system",
      group,
      Array.from({ length: 600 }, (_, i) => node(`run${group}-${i}`, "run", 100 + group * 600 + i)),
    ),
  );
  const registry = makeAtomRegistry();
  const view = render(
    <TestAttention registry={registry}>
      <Scroll maxHeight="400px">
        <SystemTree ctx={context({ trees })} />
      </Scroll>
    </TestAttention>,
  );
  const shown = view.container.querySelectorAll<HTMLElement>("[data-key]");
  expect(shown.length).toBeGreaterThan(10);
  const samples = Array.from({ length: 12 }, (_, i) => {
    const before = derivations.count;
    const start = performance.now();
    const row = shown[3 + (i % 8)]!;
    fireEvent.pointerOver(row);
    fireEvent.mouseMove(row);
    expect(row.hasAttribute("data-cursor")).toBe(true);
    return { ms: performance.now() - start, derivations: derivations.count - before };
  });
  process.stdout.write(`ducts-tree-hover ${JSON.stringify({ rows: 3606, samples })}\n`);
  vi.unstubAllGlobals();
  expect(samples.map((sample) => sample.derivations)).toEqual(Array(12).fill(0));
});

test("critical context opens initially; one selected part reveals, retains native refs, hover and rule jump", () => {
  const ctx = context({ selected: 20 });
  const ref = { elementId: 20, uniqueId: "part-twenty", documentKey: "model" };
  const registry = makeAtomRegistry();
  render(
    <TestAttention registry={registry} ids={Array.from({ length: 100 }, (_, i) => i)}>
      <NativeObservationScope value={{ scope: null, references: [ref] }}>
        <SystemTree ctx={ctx} />
      </NativeObservationScope>
    </TestAttention>,
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
  fireEvent.pointerOver(keyed("part20"));
  expect(registry.get(hovered)).toEqual({ doc: "test", key: eKey(20) });
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

// Q2: the removed Ducts Inputs pane is exercised through the admitted Fans pane instead.
test("fan facts list each reaching fan on its own calc, in roster order, and claim ESP only on a complete one", () => {
  const terminal = (id: number) => legOf(`${id}:1>`, id, "terminal", 0.1);
  const first = calcOf(1, [terminal(20)], [{ terminal: 20, legIds: ["20:1>"] }]);
  const second = calcOf(2, [terminal(20), terminal(21)], [
    { terminal: 20, legIds: ["20:1>"] },
    { terminal: 21, legIds: ["21:1>"] },
  ]);
  first.claim = { kind: "complete", basis: "test", requiredEspInWg: 0.125, coverage: [], blockingIds: [] };
  first.fan.flowCfm = 400;
  const priced = { calcs: [first, second] } as unknown as Priced;
  const scope = (...ids: number[]) => ({ terminals: new Set(ids), prices: new Set(ids) });
  const facts = fanFacts(priced, scope(20));
  expect(facts.map((f) => [f.unit, f.role, f.complete])).toEqual([
    [1, "fan", true],
    [2, "fan \u00b7 incomplete", false],
  ]);
  expect(facts[0]!.says).toBe("400 cfm \u00b7 TEL 0.0 ft \u00b7 ESP 0.125 in-wg");
  expect(facts[1]!.says).toMatch(/known 0\.000 in-wg$/);
  // A fan whose calc reaches none of the system's terminals is not one of its fans.
  expect(fanFacts(priced, scope(21)).map((f) => f.unit)).toEqual([2]);
  expect(fanFacts(priced, scope())).toEqual([]);
  expect(fanFacts(priced, null)).toEqual([]);
});

test("a unit's ports are separate fans: a port with no path is not listed, and none borrows another's TEL (P-071)", () => {
  const duct = legOf("10:1>2", 10, "duct", 0.2);
  const zero = calcOf(1, [{ ...duct, equivalentFt: 40 }], [{ terminal: 20, legIds: ["10:1>2"] }]);
  const one = calcOf(1, [], []);
  one.fan.portIndex = 1;
  const scope = { terminals: new Set([20]), prices: new Set([10, 20]) };
  expect(fanFacts(pricedOf([zero, one]), scope).map((f) => [f.key, f.tel])).toEqual([["1:0", 40]]);
  // Port 1 reaches the system only at an open end: it is listed, with no TEL of its own to claim.
  const open = calcOf(1, [legOf("10:2>1", 10, "duct", null)], [{ terminal: 99, legIds: ["10:2>1"] }]);
  open.fan.portIndex = 1;
  open.paths[0]!.end = { kind: "open-end", elementId: 10 };
  expect(fanFacts(pricedOf([zero, open]), scope).map((f) => [f.key, f.tel])).toEqual([
    ["1:0", 40],
    ["1:1", null],
  ]);
});

test("a fan whose calc reaches the system but ends at an open boundary is one of its fans, with its claim and blockers (P-072)", () => {
  const calc = calcOf(7, [legOf("10:1>2", 10, "duct", 0.2)], [{ terminal: 99, legIds: ["10:1>2"] }]);
  calc.paths[0]!.end = { kind: "open-end", elementId: 10 };
  calc.blockers = [
    { id: "open-end:10:2", kind: "open-end", elementId: 10, detail: "open", effectInWg: null, closer: { kind: "heal", note: "" } },
  ];
  const priced = pricedOf([calc]);
  const facts = fanFacts(priced, { terminals: new Set([20]), prices: new Set([10, 20]) });
  expect(facts.map((f) => [f.unit, f.claim, f.blockers, f.role])).toEqual([
    [7, "incomplete", 1, "fan \u00b7 incomplete \u00b7 1 blocker"],
  ]);
  // A scope no path of the calc touches still has no fan: "Rule a fan to price this system".
  expect(fanFacts(priced, { terminals: new Set([20]), prices: new Set([11, 20]) })).toEqual([]);
});

test("a duct with an unpriced interval has no friction loss or rate, never the priced intervals' sum (P-073)", () => {
  const interval = (id: string, dp: number | null) => ({
    ...legOf(id, 10, "duct", dp),
    evidence: { kind: "friction" as const, roughnessFt: 0.0003, lengthFt: 10, hydraulicDiameterFt: 1, ref: "test" },
  });
  const legs = [interval("10:1>2", 0.2), interval("10:2>3", null)];
  const of = (calcs: Parameters<typeof pricedOf>[0]) => runOf(pricedOf(calcs), 10);
  const run = of([calcOf(1, legs, [{ terminal: 20, legIds: ["10:1>2", "10:2>3"] }])]);
  expect([run?.lengthFt, run?.frictionDp, run?.rate]).toEqual([20, null, null]);
  expect(of([calcOf(1, legs, [{ terminal: 20, legIds: ["10:1>2"] }])])?.frictionDp).toBe(0.2);
});
