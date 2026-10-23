// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyListState, filterItems, listModel, useCollection, useList, type ListOptions } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); });

interface Item { id: string; name: string; kind: string; loss: number; stage: "clean" | "staged"; children: Item[] }
const items: Item[] = Array.from({ length: 355 }, (_, i) => ({
  id: String(10000 + i), name: `System ${i}`, kind: i % 2 ? "Return" : "Supply",
  loss: i, stage: i % 13 ? "clean" : "staged", children: [],
}));
const options: ListOptions<Item, "loss" | "name"> = {
  items, keyOf: (item) => item.id, search: (item) => ({ text: [item.name], ids: [Number(item.id)] }),
  fields: { kind: { kind: "text", read: (item) => item.kind, values: ["Supply", "Return"] },
    loss: { kind: "number", read: (item) => item.loss } },
  sorts: { loss: (item) => -item.loss, name: (item) => item.name },
  groups: { of: (item) => Number(item.id) < 10200 ? "Active" : "Settled", order: ["Active", "Settled"] },
  stageOf: (item) => item.stage,
};

test("table grammar combines words, exact numeric IDs, negation, comparisons, counted facets and typed sort", () => {
  const model = listModel(options, { ...emptyListState<"loss" | "name">(), query: "System !kind=Return loss>=200 sort:loss" });
  expect(model.shown).toBe(78);
  expect(model.sections[0]!.rows[0]!.key).toBe("10354");
  expect(model.facets.find((field) => field.key === "kind")!.values.map((value) => value.count)).toEqual([78, 77]);
  expect(model.sections[0]!.staged).toBe(6);
  expect(listModel(options, { ...emptyListState(), query: "10354" }).sections[0]!.rows.map((row) => row.key)).toEqual(["10354"]);
  expect(listModel(options, { ...emptyListState(), query: "1035" }).shown).toBe(0);
  for (const mode of ["substring", "words"] as const) {
    expect(filterItems(items, (item) => item.name, mode, '"System 2" !200').map((item) => item.name)).not.toContain("System 200");
  }
});

test("tree filtering retains ancestor context and reveal opens a closed section and every ancestor", () => {
  const root = { ...items[0]!, children: [{ ...items[1]!, children: [items[354]!] }] };
  const { result } = renderHook(() => useList({ ...options, items: [root], tree: { childrenOf: (item) => item.children },
    initialState: { query: "missing", closed: ["Active"], selected: ["10354"] } }));
  expect(result.current.shown).toBe(0);
  act(() => result.current.reveal("10354"));
  expect(result.current.state.query).toBe("");
  expect(result.current.state.closed).toEqual([]);
  expect(result.current.state.open).toEqual(["10000", "10001"]);
  expect(result.current.rows.map((row) => [row.key, row.depth])).toEqual([["10000", 0], ["10001", 1], ["10354", 2]]);
  expect(result.current.collection.cursor).toBe("10354");
  act(() => result.current.setQuery("10354"));
  expect(result.current.rows).toHaveLength(3);
  expect(result.current.shown).toBe(1);
  expect(JSON.parse(JSON.stringify(result.current.state))).toEqual(result.current.state);
});

test("multi navigation activates plain click/Enter and selects with modifiers, Space and offscreen ranges", () => {
  const picked = vi.fn();
  const region = document.createElement("div"); document.body.append(region); region.tabIndex = 0;
  const { result, unmount } = renderHook(() => useList({ ...options, select: "multi", onPick: picked }));
  act(() => result.current.setTarget(region));
  act(() => region.focus());
  act(() => result.current.collection.rowProps("10000").onClick({ shiftKey: false }));
  expect(picked).toHaveBeenCalledWith(items[0]);
  expect(result.current.state.selected).toEqual([]);
  act(() => result.current.collection.rowProps("10000").onClick({ shiftKey: false, ctrlKey: true }));
  expect(result.current.state.selected).toEqual(["10000"]);
  fireEvent.keyDown(region, { key: "End" });
  expect(result.current.collection.cursor).toBe("10354");
  fireEvent.keyDown(region, { key: "Enter" });
  expect(picked).toHaveBeenLastCalledWith(items[354]);
  fireEvent.keyDown(region, { key: " ", code: "Space" });
  expect(result.current.state.selected).toEqual(["10000", "10354"]);
  act(() => result.current.collection.pick("10000", true));
  expect(result.current.state.selected).toHaveLength(355);
  unmount(); region.remove();
});

test("popup multi still toggles on plain pick and ladders still advance", () => {
  const picked = vi.fn();
  const { result } = renderHook(() => useCollection({ items, keyOf: (item) => item.id, labelOf: (item) => item.name,
    select: "multi", onPick: picked, target: null }));
  act(() => result.current.pick("10000"));
  expect(result.current.selected).toEqual(["10000"]);
  expect(picked).not.toHaveBeenCalled();
  const ladder = renderHook(() => useCollection({ keyOf: (item: Item) => item.id, labelOf: (item) => item.name,
    levels: [{ label: "root", items: () => [items[0]!] }, { label: "child", items: () => [items[1]!] }], target: null }));
  act(() => ladder.result.current.pick("10000"));
  expect(ladder.result.current.level).toBe(1);
  expect(ladder.result.current.visible[0]!.key).toBe("10001");
});

test("facet choices replace positive equality alternatives and retain authored comparisons and negation", () => {
  const { result } = renderHook(() => useList({ ...options,
    initialState: { query: "System kind=Supply loss>=4 !kind=Other" } }));
  act(() => result.current.toggleFacet("kind", "Return"));
  expect(result.current.state.query).toBe("System loss>=4 !kind=Other kind=Return");
  act(() => result.current.toggleFacet("kind", "Return"));
  expect(result.current.state.query).toBe("System loss>=4 !kind=Other");
});

test("tiny lists render through the same rows without ResizeObserver or viewport geometry", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 3) });
    return <ListView list={list} bar={false} aria-label="tiny systems"
      row={(item) => ({ label: item.name })} empty={{ message: "No systems", exit: "Read a model" }} />;
  }
  const { container } = render(<Harness />);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(container.querySelector("[data-index]")).toBeNull();
});

test("renderer mounts a bounded viewport, exposes drop targets and distinguishes filtered empty", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scroll });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 120, right: 400, width: 400, height: 120, toJSON() {} });
  const drop = vi.fn();
  function Harness() {
    const list = useList({ ...options, groups: { of: (item) => String(Math.floor((Number(item.id) - 10000) / 40)) } });
    return <ListView list={list} aria-label="test systems" maxHeight="120px" row={(item) => ({ label: item.name })}
      sectionProps={() => ({ onDrop: drop })} empty={{ message: "No systems", exit: "Read a model" }} />;
  }
  const { container } = render(<Harness />);
  const drawn = screen.getAllByRole("option");
  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.length).toBeLessThan(355);
  fireEvent.drop(container.querySelector("[data-list-section]")!);
  expect(drop).toHaveBeenCalledTimes(1);
  const head = container.querySelector<HTMLButtonElement>("[data-list-section-head]")!;
  Object.defineProperty(head, "getBoundingClientRect", { configurable: true,
    value: () => ({ x: 0, y: 20, top: 20, left: 0, bottom: 40, right: 400, width: 400, height: 20, toJSON() {} }) });
  scroll.mockClear();
  fireEvent.click(head);
  expect(head.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox", { name: "Search test systems" }), { target: { value: "no-such-system" } });
  expect(container.querySelector('[data-story="filter"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(container.querySelector('[data-story="filter"]')).toBeNull();
});
