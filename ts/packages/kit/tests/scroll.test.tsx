// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import { Scroll } from "../src/components/lang/scroll";
import { project } from "../src/components/lang/scroll-project";

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
  expect(strip.querySelectorAll("*")).toHaveLength(3);
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
