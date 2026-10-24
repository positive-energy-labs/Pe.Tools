// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useList } from "../src/components/lang/collection";
import { Table } from "../src/components/master-table/table";
import { ListView } from "../src/components/lang/list-view";

const items = Array.from({ length: 1000 }, (_, index) => ({
  key: String(index),
  name: `Row ${index}`,
}));
const row = (item: (typeof items)[number]) => ({
  label: item.name,
  damage: item.key === "500" ? "Needs repair" : undefined,
});
function Fixture({ count }: { count: number }) {
  const list = useList({
    items: items.slice(0, count),
    keyOf: (item) => item.key,
    search: (item) => ({ text: [item.name] }),
  });
  return (
    <ListView
      list={list}
      row={row}
      maxHeight="200px"
      aria-label="rows"
      empty={{ message: "Empty", exit: "Read rows" }}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  for (const name of ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"])
    Reflect.deleteProperty(HTMLElement.prototype, name);
});

test("a vast ListView maps its virtual range and a midpoint press lands at row 500; small lists have no map", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-index") ? 20 : 200;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(24000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = this.hasAttribute("data-list-body")
        ? -(this.closest<HTMLElement>("[data-list-view]")?.scrollTop ?? 0)
        : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 200,
        right: 400,
        width: 400,
        height: 200,
        toJSON() {},
      };
    },
  );
  const scroll = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0;
    queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scroll });
  const captures = new WeakSet<HTMLElement>();
  for (const [name, value] of Object.entries({
    setPointerCapture(this: HTMLElement) {
      captures.add(this);
    },
    hasPointerCapture(this: HTMLElement) {
      return captures.has(this);
    },
    releasePointerCapture(this: HTMLElement) {
      captures.delete(this);
    },
  }))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
  const view = render(<Fixture count={1000} />);
  const minimap = view.container.querySelector<HTMLElement>("[data-minimap]")!;
  expect(minimap).toBeTruthy();
  expect(minimap.querySelector('[data-damage="Needs repair"]')).toBeTruthy();
  expect(screen.getAllByRole("option").length).toBeLessThan(50);
  fireEvent.pointerDown(minimap, { button: 0, clientY: 100, pointerId: 1 });
  await waitFor(() => {
    expect(Number(minimap.getAttribute("aria-valuenow"))).toBeGreaterThan(450);
    expect(view.container.querySelector('[data-key="500"][data-landed]')).toBeTruthy();
  });
  expect(scroll).toHaveBeenCalled();
  fireEvent.pointerMove(minimap, { clientY: 150, pointerId: 1 });
  await waitFor(() =>
    expect(view.container.querySelector('[data-key="750"][data-landed]')).toBeTruthy(),
  );
  fireEvent.pointerUp(minimap, { pointerId: 1 });
  fireEvent.keyDown(minimap, { key: "End" });
  await waitFor(() =>
    expect(view.container.querySelector('[data-key="999"][data-landed]')).toBeTruthy(),
  );
  // The same gutter and landing contract belongs to tables, including pinned active rows.
  view.rerender(
    <Table
      rows={items.map((item) => ({ ...item, damage: item.key === "500" ? "Needs repair" : null }))}
      rowKey={(item) => item.key}
      label="table rows"
      maxHeight="200px"
      activeKey="0"
      columns={[{ key: "name", label: "Name", cell: (item) => item.name }]}
    />,
  );
  const tableMap = view.container.querySelector<HTMLElement>("[data-minimap]")!;
  expect(tableMap).toBeTruthy();
  expect(tableMap.querySelector('[data-damage="Needs repair"]')).toBeTruthy();
  fireEvent.pointerDown(tableMap, { button: 0, clientY: 100, pointerId: 1 });
  await waitFor(() => {
    expect(Number(tableMap.getAttribute("aria-valuenow"))).toBeGreaterThan(450);
    expect(view.container.querySelector('tr[data-key="500"][data-landed]')).toBeTruthy();
  });
  view.rerender(<Fixture count={50} />);
  expect(view.container.querySelector("[data-minimap]")).toBeNull();
  expect(view.container.querySelector("[data-minimap-host]")).toBeNull();
});
