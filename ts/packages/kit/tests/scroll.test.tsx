// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import { Profiler } from "react";
import {
  declareMembers,
  elementKey,
  setHovered,
} from "../src/components/lang/attention";
import { AttentionFixture, kitRegistry } from "./attention-fixture";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import { Scroll } from "../src/components/lang/scroll";
import { project } from "../src/components/lang/scroll-project";
import { writeTheme } from "../src/theme";

const SEARCH = (item: { name: string }) => ({ text: [item.name] });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const quiet = () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal(
    "ResizeObserver",
    // A real observer delivers once on observe; geometry arrives only through it.
    class {
      constructor(private callback: (entries: []) => void) {}
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
};

test("the projection maps pixels, not ordinals; worst tone wins and a 1px alarm still shows", () => {
  const bins = project(
    [
      { top: 0, height: 20, mark: { tone: "caution" } },
      { top: 20, height: 60, mark: { weight: 6, tick: true } },
      { top: 80, height: 20, mark: { selected: true, hit: true } },
    ],
    100,
    100,
  );
  expect([bins.tone[0], bins.tone[19], bins.tone[20]]).toEqual([1, 1, 0]);
  expect([bins.tick[20], bins.tick[21]]).toEqual([1, 0]);
  expect(bins.weight[50]).toBeCloseTo(0.1);
  expect(bins.weight[79]).toBeCloseTo(0.1);
  expect(bins.max).toBeCloseTo(0.1);
  expect([bins.selected[79], bins.selected[80], bins.hit[99]]).toEqual([0, 1, 1]);
  const dense = project(
    [
      { top: 0, height: 1, mark: { tone: "caution" } },
      { top: 0, height: 1, mark: { tone: "alarm" } },
    ],
    1000,
    1000,
  );
  expect([dense.tone[0], dense.tone[1], dense.tone[2]]).toEqual([2, 2, 0]);
});

test("the frame follows scroll without a React commit, and the strip holds no per-item DOM", async () => {
  quiet();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
  const commits = vi.fn();
  const view = render(
    <Profiler id="scroll" onRender={commits}>
      <Scroll>
        {Array.from({ length: 100 }, (_, i) => (
          <p key={i}>row {i}</p>
        ))}
      </Scroll>
    </Profiler>,
  );
  const scroller = view.container.querySelector<HTMLElement>("[data-scroll]")!;
  const strip = scroller.querySelector<HTMLElement>("[data-scrollbar]")!;
  const frame = strip.querySelector<HTMLElement>("[data-scrollbar-frame]")!;
  expect(scroller.hasAttribute("data-scrolls")).toBe(true);
  expect(strip.style.getPropertyValue("--frame-h")).toBe("20px");
  expect(strip.style.getPropertyValue("--frame-travel")).toBe("180px");
  const before = commits.mock.calls.length;
  scroller.scrollTop = 900;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(frame.style.transform).toBe("translateY(90px)"));
  expect(commits.mock.calls.length).toBe(before);
  expect(strip.querySelectorAll("*")).toHaveLength(2);
  expect(strip.getAttribute("tabindex")).toBeNull();
});

test("the native bar is hidden on the Scroll owner itself", () => {
  const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/lang/lang.css"), "utf8");
  const owner = /\[data-scroll\]\s*\{[^}]*\}/.exec(css)![0];
  expect(owner).toMatch(/overflow:\s*auto/);
  expect(owner).toMatch(/scrollbar-width:\s*none/);
  expect(css).toMatch(/\[data-scroll\]::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
});

function Rows({ count }: { count: number }) {
  const items = Array.from({ length: count }, (_, i) => ({ key: String(i), name: `Row ${i}` }));
  const list = useList({
    items,
    keyOf: (item) => item.key,
    search: (item) => ({ text: [item.name] }),
  });
  return (
    <ListView
      list={list}
      aria-label="rows"
      row={(item) => ({ label: item.name, damage: item.key === "5" ? "unpreviewed" : undefined })}
      empty={{ message: "none", exit: "none" }}
    />
  );
}

test("a list that scrolls in a box other than its Scroll throws in development", () => {
  quiet();
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() =>
    render(
      <div style={{ overflowY: "auto" }}>
        <Rows count={10} />
      </div>,
    ),
  ).toThrow(/instead of its Scroll/);
  cleanup();
  expect(() =>
    render(
      <Scroll>
        <Rows count={10} />
      </Scroll>,
    ),
  ).not.toThrow();
});

test("a projection reads item data: it never builds rows, and damage in the data reaches the strip", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    // A real observer delivers once on observe; geometry arrives only through it.
    class {
      constructor(private callback: (entries: []) => void) {}
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const fills: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const ctx = { canvas: this, fillStyle: "", globalAlpha: 1, clearRect() {}, drawImage() {} };
      return Object.assign(ctx, { fillRect: () => fills.push(ctx.fillStyle) }) as never;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  const items = Array.from({ length: 1000 }, (_, i) => ({
    key: String(i),
    name: `Row ${i}`,
    damage: i % 10 === 0 ? "unpreviewed" : undefined,
  }));
  const row = vi.fn((item: (typeof items)[number]) => ({ label: item.name, damage: item.damage }));
  function Big() {
    const list = useList({
      items,
      keyOf: (item) => item.key,
      search: (item) => ({ text: [item.name] }),
    });
    return (
      <ListView list={list} aria-label="big" row={row} empty={{ message: "none", exit: "none" }} />
    );
  }
  render(
    <Scroll>
      <Big />
    </Scroll>,
  );
  await waitFor(() => expect(fills.length).toBeGreaterThan(0));
  expect(row.mock.calls.length).toBeLessThan(items.length / 2);
});

test("the pointer's cursor draws no strip mark: only a selection does", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: []) => void) {}
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // A full-width fill is the selected bar (no weight or tone here); ticks are half width.
  const bars: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const ctx = { canvas: this, fillStyle: "", globalAlpha: 1, clearRect() {}, drawImage() {} };
      return Object.assign(ctx, {
        fillRect: (_x: number, _y: number, w: number) => w === 1 && bars.push(w),
      }) as never;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  const items = Array.from({ length: 5 }, (_, i) => ({ key: String(i), name: `Row ${i}` }));
  function Small() {
    const list = useList({
      items,
      keyOf: (item) => item.key,
      search: (item) => ({ text: [item.name] }),
      select: "single",
    });
    return (
      <ListView
        list={list}
        aria-label="small"
        row={(item) => ({ label: item.name })}
        empty={{ message: "none", exit: "none" }}
      />
    );
  }
  const view = render(
    <Scroll>
      <Small />
    </Scroll>,
  );
  const row = view.container.querySelector('[data-key="3"]')!;
  fireEvent.mouseMove(row);
  await waitFor(() => expect(row.hasAttribute("data-cursor")).toBe(true));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(bars).toEqual([]);
  fireEvent.click(row);
  await waitFor(() => expect(bars.length).toBeGreaterThan(0));
});

test("rows another surface's hover reaches mark the strip, from row data, without a commit", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: []) => void) {}
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const bars: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const ctx = { canvas: this, fillStyle: "", globalAlpha: 1, clearRect() {}, drawImage() {} };
      return Object.assign(ctx, {
        fillRect: (_x: number, y: number, w: number) => w === 1 && bars.push(y),
      }) as never;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40000);
  // Virtual: most rows never mount, so marks must come from item data, not DOM.
  const items = Array.from({ length: 2000 }, (_, i) => ({ key: String(i + 1), name: `Row ${i}` }));
  const row = vi.fn((item: (typeof items)[number]) => ({ label: item.name }));
  function Big() {
    const list = useList({ items, keyOf: (item) => item.key, search: SEARCH });
    return (
      <ListView list={list} aria-label="big" row={row} empty={{ message: "none", exit: "none" }} />
    );
  }
  const commits = vi.fn();
  const registry = kitRegistry();
  const view = render(
    <RegistryContext value={registry}>
      <AttentionFixture>
        <Profiler id="list" onRender={commits}>
          <Scroll>
            <Big />
          </Scroll>
        </Profiler>
      </AttentionFixture>
    </RegistryContext>,
  );
  // A 3D group of 60 elements, spread across the list (rows 1..1950 step 33).
  const members = Array.from({ length: 60 }, (_, i) => elementKey(1 + i * 33));
  declareMembers(registry, "kit", new Map([["g:run" as const, members]]));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  bars.length = 0;
  const before = commits.mock.calls.length;
  const started = performance.now();
  act(() => setHovered(registry, { doc: "kit", key: "g:run" }));
  const cold = performance.now() - started;
  expect(commits.mock.calls.length).toBe(before);
  await waitFor(() => expect(bars.length).toBeGreaterThan(0));
  expect(new Set(bars).size).toBeGreaterThanOrEqual(50);
  act(() => setHovered(registry, null));
  const again = performance.now();
  act(() => setHovered(registry, { doc: "kit", key: "g:run" }));
  const warm = performance.now() - again;
  // A loose bound, not a benchmark (jsdom 2026-10-24: the recompute alone took 2-6 ms cold, with
  // each row's subject built once, and 1-2 ms warm; act() adds the rest). The old per-key rung
  // atoms (a rung atom read per row) took 450+ ms cold here.
  expect(cold).toBeLessThan(150);
  expect(warm).toBeLessThan(50);
  // The list's own pointer hover lights its row but draws no mark.
  act(() => setHovered(registry, null));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  bars.length = 0;
  const list = view.container.querySelector("[data-list-view]")!;
  fireEvent.pointerEnter(list);
  const own = view.container.querySelector('[data-key="1"]')!;
  fireEvent.pointerOver(own);
  fireEvent.mouseMove(own);
  await waitFor(() => expect(own.getAttribute("data-reach")).toBe("hover"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(bars).toEqual([]);
});

test("an observer delivery that changes nothing here writes nothing (a seam drag's width frames)", () => {
  let deliver = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: []) => void) {
        deliver = () => this.callback([]);
      }
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return { canvas: this, clearRect() {}, fillRect() {}, drawImage() {} } as never;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
  render(
    <Scroll>
      <p>row</p>
    </Scroll>,
  );
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
  const styles = vi.spyOn(window, "getComputedStyle");
  deliver();
  expect([writes.mock.calls.length, styles.mock.calls.length]).toEqual([0, 0]);
});

// Real-observer stand-in: delivers on observe and on demand; records frame-time layout reads.
function frameHarness() {
  const callbacks = new Set<(entries: []) => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: []) => void) {
        callbacks.add(callback);
      }
      observe() {
        this.callback([]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const fills: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      const ctx = { canvas: this, fillStyle: "", globalAlpha: 1, clearRect() {}, drawImage() {} };
      return Object.assign(ctx, { fillRect: () => fills.push(ctx.fillStyle) }) as never;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
  let inFrame = false;
  const native = window.requestAnimationFrame.bind(window);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    native((t) => {
      inFrame = true;
      try {
        callback(t);
      } finally {
        inFrame = false;
      }
    }),
  );
  let frameReads = 0;
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (inFrame) frameReads++;
    return rect.call(this);
  });
  return { fills, frameReads: () => frameReads, deliver: () => callbacks.forEach((c) => c([])) };
}

function Sections() {
  const items = Array.from({ length: 30 }, (_, i) => ({ key: String(i), name: `Row ${i}` }));
  const list = useList({
    items,
    keyOf: (item) => item.key,
    search: (item) => ({ text: [item.name] }),
    groups: { of: (item) => `Section ${Math.floor(Number(item.key) / 10)}` },
  });
  return (
    <ListView
      list={list}
      aria-label="sections"
      row={(item) => ({ label: item.name })}
      empty={{ message: "none", exit: "none" }}
    />
  );
}

test("a filter change places section ticks and rows in the observer, never inside a frame", async () => {
  const harness = frameHarness();
  const view = render(
    <Scroll>
      <Sections />
    </Scroll>,
  );
  await waitFor(() => expect(harness.fills.length).toBeGreaterThan(0));
  const input = view.container.querySelector<HTMLInputElement>("[data-list-bar] input")!;
  const before = harness.fills.length;
  fireEvent.change(input, { target: { value: "Row 1" } });
  harness.deliver();
  await waitFor(() => expect(harness.fills.length).toBeGreaterThan(before));
  expect(harness.frameReads()).toBe(0);
});

test("a theme toggle re-resolves the strip ink once and repaints", async () => {
  const harness = frameHarness();
  render(
    <Scroll>
      <Sections />
    </Scroll>,
  );
  await waitFor(() => expect(harness.fills.length).toBeGreaterThan(0));
  const styles = vi.spyOn(window, "getComputedStyle");
  const before = harness.fills.length;
  writeTheme("dark");
  const canvasReads = styles.mock.calls.filter(([el]) => el instanceof HTMLCanvasElement).length;
  expect(canvasReads).toBe(4);
  await waitFor(() => expect(harness.fills.length).toBeGreaterThan(before));
  writeTheme("auto");
});
