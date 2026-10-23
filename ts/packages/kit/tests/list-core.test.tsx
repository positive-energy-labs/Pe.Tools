// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  emptyListState,
  filterItems,
  listModel,
  useCollection,
  useList,
  type ListOptions,
} from "../src/components/lang/collection";
import { type ListSearch } from "@pe/agent-contracts";
import { ListBar, ListView, PlainList, useSearchKey } from "../src/components/lang/list-view";
import { land } from "../src/components/lang/row";
import { readGestures, readKeyMeta, readRegistrations } from "../src/keys";

const search = (keywords = "", pills: Record<string, string> = {}): ListSearch => ({
  v: 1,
  keywords,
  pills: Object.entries(pills).map(([field, value]) => ({ field, op: "=", value })),
});

test("slash targets a separate filter bar from its focused list body", () => {
  function Fixture() {
    const list = useList({ ...options, items: items.slice(0, 2) });
    return (
      <>
        <ListBar list={list} label="separate" />
        <ListView
          list={list}
          bar={false}
          aria-label="separate"
          row={(item) => ({ label: item.name })}
          empty={{ message: "Empty", exit: "Add a row" }}
        />
      </>
    );
  }
  render(<Fixture />);
  const body = screen.getByRole("listbox", { name: "separate" });
  body.focus();
  fireEvent.keyDown(body, { key: "/", code: "Slash" });
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search separate" }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

test("typing filters locally, publishes once on idle, and indexes search only on a data read", () => {
  vi.useFakeTimers();
  const search = vi.fn(options.search);
  const onState = vi.fn();
  const state = emptyListState<"loss" | "name">();
  const hook = renderHook(
    ({ data }) => useList({ ...options, items: data, search, state, onState }),
    {
      initialProps: { data: items },
    },
  );
  expect(search).toHaveBeenCalledTimes(355);
  act(() => hook.result.current.setKeywords("System"));
  act(() => {
    vi.advanceTimersByTime(150);
  });
  act(() => hook.result.current.setKeywords("System 354"));
  expect(hook.result.current.shown).toBe(1);
  expect(onState).not.toHaveBeenCalled();
  expect(search).toHaveBeenCalledTimes(355);
  act(() => {
    vi.advanceTimersByTime(249);
  });
  expect(onState).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(onState).toHaveBeenCalledTimes(1);
  expect(onState.mock.lastCall?.[0].search.keywords).toBe("System 354");
  hook.rerender({ data: items.map((item) => ({ ...item, name: "Changed" })) });
  expect(search).toHaveBeenCalledTimes(710);
  expect(hook.result.current.shown).toBe(0);
});

test("address navigation cancels pending typing; an idle acknowledgement preserves newer typing", () => {
  vi.useFakeTimers();
  const onState = vi.fn();
  const hook = renderHook(
    ({ query }) =>
      useList({
        ...options,
        state: { ...emptyListState<"loss" | "name">(), search: search(query) },
        onState,
      }),
    {
      initialProps: { query: "" },
    },
  );
  act(() => hook.result.current.setKeywords("System"));
  act(() => {
    vi.advanceTimersByTime(250);
  });
  act(() => hook.result.current.setKeywords("System 354"));
  hook.rerender({ query: "System" });
  expect(hook.result.current.state.search.keywords).toBe("System 354");
  hook.rerender({ query: "kind=Return" });
  expect(hook.result.current.state.search.keywords).toBe("kind=Return");
  hook.rerender({ query: "System" });
  expect(hook.result.current.state.search.keywords).toBe("System");
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onState).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.setKeywords("unfinished"));
  hook.unmount();
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onState).toHaveBeenCalledTimes(1);
});

interface Item {
  id: string;
  name: string;
  kind: string;
  loss: number;
  stage: "clean" | "staged";
  children: Item[];
}
const items: Item[] = Array.from({ length: 355 }, (_, i) => ({
  id: String(10000 + i),
  name: `System ${i}`,
  kind: i % 2 ? "Return" : "Supply",
  loss: i,
  stage: i % 13 ? "clean" : "staged",
  children: [],
}));
const options: ListOptions<Item, "loss" | "name"> = {
  items,
  keyOf: (item) => item.id,
  search: (item) => ({ text: [item.name], ids: [Number(item.id)] }),
  fields: {
    kind: { kind: "text", read: (item) => item.kind, values: ["Supply", "Return"] },
    loss: { kind: "number", read: (item) => item.loss },
  },
  sorts: { loss: (item) => -item.loss, name: (item) => item.name },
  groups: {
    of: (item) => (Number(item.id) < 10200 ? "Active" : "Settled"),
    order: ["Active", "Settled"],
  },
  stageOf: (item) => item.stage,
};

test("literal words AND across fields, IDs are exact, and pills narrow before separate sorting", () => {
  const model = listModel(options, {
    ...emptyListState<"loss" | "name">(),
    search: search("sYsTeM", { kind: "Supply" }),
    sort: "loss",
  });
  expect(model.shown).toBe(178);
  expect(model.sections[0]!.rows[0]!.key).toBe("10198");
  expect(model.valuesFor("kind").map((value) => value.count)).toEqual([178, 177]);
  expect(listModel(options, { ...emptyListState(), search: search("10354") }).shown).toBe(1);
  expect(listModel(options, { ...emptyListState(), search: search("1035") }).shown).toBe(0);
  for (const keywords of ["kind=Supply", "air:", "!Return", '"System"', "sort:loss"])
    expect(listModel(options, { ...emptyListState(), search: search(keywords) }).shown).toBe(0);
  for (const mode of ["substring", "words"] as const)
    expect(
      filterItems(items, (item) => item.name, mode, '"System 2" !200').map((item) => item.name),
    ).not.toContain("System 200");
});

test("tree filtering retains ancestor context and reveal opens a closed section and every ancestor", () => {
  const root = { ...items[0]!, children: [{ ...items[1]!, children: [items[354]!] }] };
  const { result } = renderHook(() =>
    useList({
      ...options,
      items: [root],
      tree: { childrenOf: (item) => item.children },
      initialState: { search: search("missing"), closed: ["Active"], selected: ["10354"] },
    }),
  );
  expect(result.current.shown).toBe(0);
  act(() => result.current.reveal("10354"));
  expect(result.current.state.search.keywords).toBe("");
  expect(result.current.state.closed).toEqual([]);
  expect(result.current.state.open).toEqual(["10000", "10001"]);
  expect(result.current.rows.map((row) => [row.key, row.depth])).toEqual([
    ["10000", 0],
    ["10001", 1],
    ["10354", 2],
  ]);
  expect(result.current.collection.cursor).toBe("10354");
  act(() => result.current.setKeywords("10354"));
  expect(result.current.rows).toHaveLength(3);
  expect(result.current.shown).toBe(1);
  expect(JSON.parse(JSON.stringify(result.current.state))).toEqual(result.current.state);
});

test("multi navigation activates plain click/Enter and selects with modifiers, Space and offscreen ranges", () => {
  const picked = vi.fn();
  const region = document.createElement("div");
  document.body.append(region);
  region.tabIndex = 0;
  const { result, unmount } = renderHook(() =>
    useList({ ...options, select: "multi", onPick: picked }),
  );
  act(() => result.current.setTarget(region));
  act(() => region.focus());
  act(() => result.current.collection.rowProps("10000").onClick({ shiftKey: false }));
  expect(picked).toHaveBeenCalledWith(items[0]);
  expect(result.current.state.selected).toEqual([]);
  act(() =>
    result.current.collection.rowProps("10000").onClick({ shiftKey: false, ctrlKey: true }),
  );
  expect(result.current.state.selected).toEqual(["10000"]);
  fireEvent.keyDown(region, { key: "End" });
  expect(result.current.collection.cursor).toBe("10354");
  fireEvent.keyDown(region, { key: "Enter" });
  expect(picked).toHaveBeenLastCalledWith(items[354]);
  fireEvent.keyDown(region, { key: " ", code: "Space" });
  expect(result.current.state.selected).toEqual(["10000", "10354"]);
  act(() => result.current.collection.pick("10000", true));
  expect(result.current.state.selected).toHaveLength(355);
  unmount();
  region.remove();
});

test("popup multi still toggles on plain pick and ladders still advance", () => {
  const picked = vi.fn();
  const { result } = renderHook(() =>
    useCollection({
      items,
      keyOf: (item) => item.id,
      labelOf: (item) => item.name,
      select: "multi",
      onPick: picked,
      target: null,
    }),
  );
  act(() => result.current.pick("10000"));
  expect(result.current.selected).toEqual(["10000"]);
  expect(picked).not.toHaveBeenCalled();
  const ladder = renderHook(() =>
    useCollection({
      keyOf: (item: Item) => item.id,
      labelOf: (item) => item.name,
      levels: [
        { label: "root", items: () => [items[0]!] },
        { label: "child", items: () => [items[1]!] },
      ],
      target: null,
    }),
  );
  act(() => ladder.result.current.pick("10000"));
  expect(ladder.result.current.level).toBe(1);
  expect(ladder.result.current.visible[0]!.key).toBe("10001");
});

test("new equality replaces the field in place and candidate counts retain other pills and keywords", () => {
  const { result } = renderHook(() =>
    useList({
      ...options,
      initialState: { search: search("System", { kind: "Supply", change: "staged" }) },
    }),
  );
  act(() => result.current.pickPill("kind", "Return"));
  expect(result.current.state.search).toEqual(
    search("System", { kind: "Return", change: "staged" }),
  );
  expect(result.current.valuesFor("kind").map((each) => each.count)).toEqual([14, 14]);
  act(() => result.current.removePill("kind"));
  expect(result.current.state.search).toEqual(search("System", { change: "staged" }));
});

test("unknown versions, fields and operators refuse instead of broadening", () => {
  for (const invalid of [
    { ...search(), v: 8 },
    search("", { unknown: "x" }),
    { ...search(), pills: [{ field: "kind", op: "!=", value: "Supply" }] },
  ]) {
    const model = listModel(options, { ...emptyListState(), search: invalid });
    expect(model.refusal).toBeTruthy();
    expect(model.shown).toBe(0);
  }
});

test("completion is explicit, cancels losslessly, previews token removal, and replaces pills", async () => {
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 3) });
    return (
      <ListView
        list={list}
        aria-label="completion"
        row={(item) => ({ label: item.name })}
        empty={{ message: "Empty", exit: "Read rows" }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "Search completion" });
  input.focus();
  fireEvent.change(input, { target: { value: "System kind" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("value")).toBe("System kind");
  expect(screen.queryByRole("button", { name: /Remove the "Kind/ })).toBeNull();
  // Enter commits keywords; a later edit reopens completion explicitly.
  fireEvent.change(input, { target: { value: "System kin" } });
  fireEvent.change(input, { target: { value: "System kind" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  const picker = screen.getByRole("combobox", { name: "Choose Kind" });
  expect(screen.getByRole("option", { name: /Supply2/ })).toBeTruthy();
  fireEvent.keyDown(picker, { key: "Escape" });
  expect(input.getAttribute("value")).toBe("System kind");
  fireEvent.change(input, { target: { value: "System kin" } });
  fireEvent.change(input, { target: { value: "System kind" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: /Supply2/ }));
  expect(input.getAttribute("value")).toBe("System");
  expect(screen.getByRole("button", { name: 'Remove the "Kind: Supply" narrowing' })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Kind: Supply" }));
  fireEvent.click(screen.getByRole("option", { name: /Return1/ }));
  expect(screen.queryByRole("button", { name: 'Remove the "Kind: Supply" narrowing' })).toBeNull();
  expect(screen.getByRole("button", { name: 'Remove the "Kind: Return" narrowing' })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("value")).toBe("");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Backspace", isComposing: true });
  expect(screen.getByRole("button", { name: 'Remove the "Kind: Return" narrowing' })).toBeTruthy();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("button", { name: /Remove the "Kind/ })).toBeNull();
});

test("a typed word completes as a ghost, Tab or → takes it, and Backspace reopens the last pill", () => {
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 3) });
    return (
      <ListView
        list={list}
        aria-label="ghost"
        row={(item) => ({ label: item.name })}
        empty={{ message: "Empty", exit: "Read rows" }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "Search ghost" });
  const removeSupply = () =>
    screen.queryByRole("button", { name: 'Remove the "Kind: Supply" narrowing' });
  input.focus();
  fireEvent.change(input, { target: { value: "sup" } });
  expect(document.querySelector("[data-completion-ghost]")?.textContent).toBe("supply");
  expect(screen.getByRole("option", { name: /Search “sup”/ })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Tab" });
  expect(removeSupply()).toBeTruthy();
  expect(input.getAttribute("value")).toBe("");
  // Backspace on the empty box edits the last pill in place; Escape puts it back untouched.
  fireEvent.keyDown(input, { key: "Backspace" });
  const editing = screen.getByRole("combobox", { name: "Choose Kind" });
  expect(editing.getAttribute("value")).toBe("Supply");
  expect(removeSupply()).toBeNull();
  expect(document.querySelector("[data-list-draft]")?.textContent).toBe("Kind:");
  fireEvent.keyDown(editing, { key: "Escape" });
  expect(removeSupply()).toBeTruthy();
  // Emptied, a second Backspace removes it.
  fireEvent.keyDown(input, { key: "Backspace" });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(removeSupply()).toBeNull();
  expect(screen.getByRole("combobox", { name: "Search ghost" })).toBe(input);
  // → at the end of the word takes the ghost too.
  fireEvent.change(input, { target: { value: "ret" } });
  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: 'Remove the "Kind: Return" narrowing' })).toBeTruthy();
  // Escape walks back: the pill, then out of the box.
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("button", { name: /Remove the "Kind/ })).toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).not.toBe(input);
});

test("a stable row callback lets a selection redraw only the rows it touched", () => {
  const drawn: string[] = [];
  const row = (item: Item) => {
    drawn.push(item.id);
    return { label: item.name };
  };
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 5) });
    return (
      <ListView
        list={list}
        aria-label="memo"
        row={row}
        empty={{ message: "Empty", exit: "Read rows" }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("System 1"));
  drawn.length = 0;
  fireEvent.click(screen.getByText("System 3"));
  expect([...new Set(drawn)].sort()).toEqual([items[1]!.id, items[3]!.id]);
});

test("Filter preserves keywords, exposes disabled zero values, and Enter never picks a data row", () => {
  const picked = vi.fn();
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 3), onPick: picked });
    return (
      <ListView
        list={list}
        aria-label="button search"
        row={(item) => ({ label: item.name })}
        empty={{ message: "Empty", exit: "Read rows" }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "Search button search" });
  fireEvent.change(input, { target: { value: "air:" } });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("value")).toBe("");
  fireEvent.change(input, { target: { value: "System 0" } });
  fireEvent.click(screen.getByRole("button", { name: "Filter button search" }));
  fireEvent.click(screen.getByRole("option", { name: /^Filter by Kind/ }));
  const zero = screen.getByRole("option", { name: /Return0/ });
  expect(zero.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(zero);
  expect(screen.queryByRole("button", { name: /Remove the "Kind/ })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /Supply1/ }));
  expect(input.getAttribute("value")).toBe("System 0");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(picked).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input.getAttribute("value")).toBe("");
  expect(screen.queryByRole("button", { name: /Remove the "Kind/ })).toBeNull();
});

test("a pill publishes immediately once; scope change and unmount cancel delayed search", () => {
  vi.useFakeTimers();
  const onState = vi.fn();
  const state = { ...emptyListState<"name" | "loss">(), search: search() };
  const hook = renderHook(({ scope }) => useList({ ...options, state, onState, scope }), {
    initialProps: { scope: "A" },
  });
  act(() => hook.result.current.pickPill("kind", "Supply"));
  expect(onState).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onState).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.setKeywords("pending"));
  hook.rerender({ scope: "B" });
  expect(hook.result.current.state.search).toEqual(search());
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onState).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.setKeywords("pending"));
  hook.unmount();
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onState).toHaveBeenCalledTimes(1);
});

test("tiny lists render through the same rows without ResizeObserver or viewport geometry", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 3) });
    return (
      <PlainList
        list={list}
        aria-label="tiny systems"
        row={(item) => ({ label: item.name })}
        empty={{ message: "No systems", exit: "Read a model" }}
      />
    );
  }
  const { container } = render(<Harness />);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(container.querySelector("[data-index]")).toBeNull();
});

test("small-list keyboard and repeated reveal scroll the mounted row with the nearest rule", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const scrolled: string[] = [];
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement, rule: ScrollIntoViewOptions) {
      expect(rule).toMatchObject({ block: "nearest" });
      scrolled.push(this.dataset.key!);
    },
  });
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 40) });
    return (
      <>
        <button onClick={() => list.reveal("10039")}>Reveal last</button>
        <ListView
          list={list}
          bar={false}
          maxHeight="100px"
          aria-label="small systems"
          row={(item) => ({ label: item.name })}
          empty={{ message: "No systems", exit: "Read a model" }}
        />
      </>
    );
  }
  render(<Harness />);
  const region = screen.getByRole("listbox", { name: "small systems" });
  act(() => region.focus());
  fireEvent.keyDown(region, { key: "End" });
  expect(scrolled.at(-1)).toBe("10039");
  const count = scrolled.length;
  fireEvent.click(screen.getByRole("button", { name: "Reveal last" }));
  expect(scrolled).toHaveLength(count + 1);
  expect(scrolled.at(-1)).toBe("10039");
  expect(document.querySelector('[data-key="10039"]')?.hasAttribute("data-landed")).toBe(true);
});

test("renderer mounts a bounded viewport, exposes drop targets and distinguishes filtered empty", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scroll });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 120,
    right: 400,
    width: 400,
    height: 120,
    toJSON() {},
  });
  const drop = vi.fn();
  function Harness() {
    const list = useList({
      ...options,
      groups: { of: (item) => String(Math.floor((Number(item.id) - 10000) / 40)) },
    });
    return (
      <ListView
        list={list}
        aria-label="test systems"
        maxHeight="120px"
        row={(item) => ({ label: item.name })}
        sectionProps={() => ({ onDrop: drop })}
        empty={{ message: "No systems", exit: "Read a model" }}
      />
    );
  }
  const { container } = render(<Harness />);
  const drawn = screen.getAllByRole("option");
  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.length).toBeLessThan(355);
  fireEvent.drop(container.querySelector("[data-list-section]")!);
  expect(drop).toHaveBeenCalledTimes(1);
  const head = container.querySelector<HTMLButtonElement>("[data-list-section-head]")!;
  Object.defineProperty(head, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 20,
      top: 20,
      left: 0,
      bottom: 40,
      right: 400,
      width: 400,
      height: 20,
      toJSON() {},
    }),
  });
  scroll.mockClear();
  fireEvent.click(head);
  expect(head.getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("combobox", { name: "Search test systems" }), {
    target: { value: "no-such-system" },
  });
  expect(container.querySelector('[data-story="filter"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(container.querySelector('[data-story="filter"]')).toBeNull();
});

test("row editors and controls keep native keys without moving, expanding, picking or clearing the list", () => {
  const region = document.createElement("div");
  const row = document.createElement("div");
  row.className = "dl-row";
  const input = document.createElement("input");
  row.append(input);
  region.append(row);
  document.body.append(region);
  const picked = vi.fn();
  const root = { ...items[0]!, children: [items[1]!] };
  const { result, unmount } = renderHook(() =>
    useList({
      ...options,
      items: [root],
      tree: { childrenOf: (item) => item.children },
      onPick: picked,
      initialState: { search: search("System") },
    }),
  );
  act(() => {
    result.current.setTarget(region);
    result.current.collection.setCursor(root.id);
  });
  input.focus();
  const before = result.current.state;
  for (const key of [
    "ArrowDown",
    "ArrowUp",
    "Home",
    "End",
    "ArrowLeft",
    "ArrowRight",
    "Enter",
    "Escape",
    " ",
  ]) {
    expect(fireEvent.keyDown(input, { key, code: key === " " ? "Space" : key })).toBe(true);
    expect(result.current.collection.cursor).toBe(root.id);
    expect(result.current.state).toEqual(before);
  }
  expect(picked).not.toHaveBeenCalled();
  const button = document.createElement("button");
  row.append(button);
  button.focus();
  expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
  expect(picked).not.toHaveBeenCalled();
  unmount();
  region.remove();
});

test("an external combobox inside another row retains collection keys and ListBar search retains list keys", () => {
  const host = document.createElement("div");
  host.className = "dl-row";
  const input = document.createElement("input");
  host.append(input);
  document.body.append(host);
  const picked = vi.fn();
  const { result, unmount } = renderHook(() =>
    useCollection({
      items: items.slice(0, 2),
      keyOf: (item) => item.id,
      labelOf: (item) => item.name,
      target: input,
      onPick: picked,
    }),
  );
  input.focus();
  expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(false);
  expect(result.current.cursor).toBe(items[0]!.id);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(picked).toHaveBeenCalledWith(items[0], []);
  unmount();
  host.remove();
  const pick = vi.fn();
  function Harness() {
    const list = useList({ ...options, items: items.slice(0, 2), onPick: pick });
    return (
      <ListView
        list={list}
        aria-label="query keys"
        row={(item) => ({ label: item.name })}
        empty={{ message: "No rows", exit: "Read rows" }}
      />
    );
  }
  render(<Harness />);
  const query = screen.getByRole("combobox", { name: "Search query keys" });
  query.focus();
  fireEvent.keyDown(query, { key: "ArrowDown" });
  const rows = screen.getByRole("listbox", { name: "query keys" });
  expect(document.activeElement).toBe(rows);
  fireEvent.keyDown(rows, { key: "Enter" });
  expect(pick).toHaveBeenCalledWith(items[0]);
});

test("after Enter commits completion, ArrowDown enters filtered rows and Escape keeps its layers", () => {
  const picked = vi.fn();
  const data = items.slice(0, 3).map((item) => ({ ...item, name: `${item.kind} ${item.name}` }));
  function Fixture() {
    const list = useList({ ...options, items: data, onPick: picked });
    return (
      <ListView
        list={list}
        aria-label="committed search"
        row={(item) => ({ label: item.name })}
        empty={{ message: "Empty", exit: "Read rows" }}
      />
    );
  }
  render(<Fixture />);
  const input = screen.getByRole("combobox", { name: "Search committed search" });
  input.focus();
  fireEvent.change(input, { target: { value: "System" } });
  fireEvent.click(screen.getByRole("button", { name: "Filter committed search" }));
  fireEvent.click(screen.getByRole("option", { name: /^Filter by Kind/ }));
  fireEvent.click(screen.getByRole("option", { name: /Supply2/ }));
  fireEvent.change(input, { target: { value: "Sup" } });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(picked).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const rows = screen.getByRole("listbox", { name: "committed search" });
  expect(document.activeElement).toBe(rows);
  expect(rows.getAttribute("aria-activedescendant")).toContain(data[0]!.id);
  fireEvent.keyDown(rows, { key: "Enter" });
  expect(picked).toHaveBeenCalledWith(data[0]);
  input.focus();
  fireEvent.change(input, { target: { value: "System kind" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("value")).toBe("System kind");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("value")).toBe("");
  expect(screen.getByRole("button", { name: 'Remove the "Kind: Supply" narrowing' })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("button", { name: 'Remove the "Kind: Supply" narrowing' })).toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(rows);
});

test("list help declares pointer behavior and keeps cursor keys registered once", () => {
  function Fixture() {
    const list = useList({ ...options, items: items.slice(0, 2) });
    return (
      <ListView
        list={list}
        bar={false}
        aria-label="gesture list"
        row={(item) => ({ label: item.name })}
        empty={{ message: "Empty", exit: "Add a row" }}
      />
    );
  }
  const view = render(<Fixture />);
  const gestures = readGestures();
  expect(gestures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pointer: "click", label: "select the row" }),
      expect.objectContaining({ pointer: "hover", label: "move the cursor" }),
    ]),
  );
  expect(gestures.some((gesture) => gesture.keys?.length)).toBe(false);
  const down = readRegistrations().filter(
    (entry) => readKeyMeta(entry.options.meta)?.name === "next",
  );
  expect(down).toHaveLength(1);
  view.unmount();
  expect(readGestures()).toEqual([]);
});

test("land restarts one token-timed mark and optionally focuses the destination control", () => {
  vi.useFakeTimers();
  const el = document.createElement("div");
  el.style.setProperty("--motion-land", "1.4s");
  el.innerHTML = '<input aria-label="destination" />';
  document.body.append(el);
  const scroll = vi.fn();
  el.scrollIntoView = scroll;
  land(el, { focus: true });
  expect(document.activeElement).toBe(el.firstElementChild);
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "instant" });
  expect(el.hasAttribute("data-landed")).toBe(true);
  vi.advanceTimersByTime(1000);
  land(el);
  vi.advanceTimersByTime(1000);
  expect(el.hasAttribute("data-landed")).toBe(true);
  vi.advanceTimersByTime(400);
  expect(el.hasAttribute("data-landed")).toBe(false);
  el.remove();
});

test("persist owns search and sort without publishing selection-only changes", () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const hook = renderHook(
    ({ keywords }) =>
      useList({
        ...options,
        persist: { search: search(keywords), sort: "name", onChange: changed },
      }),
    { initialProps: { keywords: "System 1" } },
  );
  act(() => hook.result.current.toggleOpen("10001"));
  expect(changed).not.toHaveBeenCalled();
  act(() => hook.result.current.setSort("loss"));
  expect(changed).toHaveBeenLastCalledWith(search("System 1"), "loss");
  act(() => hook.result.current.setKeywords("waiting"));
  hook.rerender({ keywords: "System 2" });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.search).toEqual(search("System 2"));
});

test("slash arbitration prioritizes focused regions, leaves text editing alone and hands off on unmount", () => {
  const first = vi.fn(),
    second = vi.fn();
  function Owner({ id, primary, focus }: { id: string; primary?: boolean; focus: () => void }) {
    useSearchKey({ region: () => document.getElementById(id), primary, focus });
    return (
      <div id={id} tabIndex={0}>
        <input aria-label={id} />
      </div>
    );
  }
  const view = render(
    <>
      <Owner id="first" primary focus={first} />
      <Owner id="second" focus={second} />
    </>,
  );
  expect(
    readRegistrations().filter((entry) => readKeyMeta(entry.options.meta)?.name === "Search"),
  ).toHaveLength(1);
  document.getElementById("second")!.focus();
  fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash" });
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  screen.getByRole("textbox", { name: "second" }).focus();
  fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash" });
  expect(second).toHaveBeenCalledTimes(1);
  view.rerender(<Owner id="second" primary focus={second} />);
  document.getElementById("second")!.focus();
  fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash" });
  expect(second).toHaveBeenCalledTimes(2);
});

test("following waits for an excluded query and opens ancestors only once per selection", () => {
  const child = { ...items[1]!, children: [] };
  const root = { ...items[0]!, children: [child] };
  const hook = renderHook(
    ({ selected }) =>
      useList({
        ...options,
        items: [root],
        tree: { childrenOf: (item) => item.children },
        initialState: { search: search("excluded") },
        followSelection: { key: selected },
      }),
    { initialProps: { selected: child.id as string | null } },
  );
  expect(hook.result.current.state.open).toContain(root.id);
  expect(hook.result.current.state.search.keywords).toBe("excluded");
  expect(hook.result.current.revealRequest).toBeNull();
  act(() => hook.result.current.clearSearch());
  expect(hook.result.current.revealRequest?.key).toBe(child.id);
  const serial = hook.result.current.revealRequest?.serial;
  act(() => hook.result.current.toggleOpen(root.id));
  expect(hook.result.current.state.open).not.toContain(root.id);
  hook.rerender({ selected: child.id });
  expect(hook.result.current.state.open).not.toContain(root.id);
  expect(hook.result.current.revealRequest?.serial).toBe(serial);
  hook.rerender({ selected: null });
  hook.rerender({ selected: child.id });
  expect(hook.result.current.state.open).toContain(root.id);
  expect(hook.result.current.revealRequest?.serial).toBe((serial ?? 0) + 1);
});
