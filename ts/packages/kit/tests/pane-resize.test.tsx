// @vitest-environment jsdom
import { Profiler, useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { PaneSplit } from "@pe/kit/lang/pane-resize";
import { Pane } from "@pe/kit/lang/pane";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function measure(width: number, height = 600) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, width, height),
  );
  const style = CSSStyleDeclaration.prototype;
  const get = style.getPropertyValue;
  vi.spyOn(style, "getPropertyValue").mockImplementation(
    function (this: CSSStyleDeclaration, name) {
      return name === "--gutter" ? "8px" : get.call(this, name);
    },
  );
}

test("a folded pane releases effects, retains edits, and reveals only current action inputs", () => {
  measure(1200);
  const acquire = vi.fn(),
    release = vi.fn(),
    actOn = vi.fn();
  function Editor({ scope }: { scope: string }) {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      acquire(scope);
      return () => release(scope);
    }, [scope]);
    return (
      <>
        <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button onClick={() => actOn(scope, draft)}>Act on {scope}</button>
      </>
    );
  }
  const dock = (folded: boolean, scope: string) => (
    <PaneSplit
      axis="horizontal"
      start="picture"
      end={<Editor scope={scope} />}
      resize={{
        target: "end",
        defaultSize: 400,
        minSize: 200,
        collapse: {
          collapsed: folded ? "end" : null,
          onCollapsedChange: () => {},
          end: { title: "Editor" },
        },
      }}
    />
  );
  const view = render(dock(false, "A"));
  fireEvent.change(screen.getByRole("textbox", { name: "draft" }), { target: { value: "kept" } });
  view.rerender(dock(true, "B"));
  expect(release).toHaveBeenCalledWith("A");
  expect(acquire).not.toHaveBeenCalledWith("B");
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(dock(false, "C"));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("kept");
  fireEvent.click(screen.getByRole("button", { name: "Act on C" }));
  expect(actOn).toHaveBeenCalledWith("C", "kept");
  expect(acquire).toHaveBeenLastCalledWith("C");
});

test.each(["horizontal", "vertical"] as const)(
  "fitting %s reserves the subject minimum and centres the seam grip through pre-observer layout changes",
  (axis) => {
    measure(axis === "horizontal" ? 900 : 600, axis === "horizontal" ? 600 : 900);
    const { container } = render(
      <PaneSplit
        axis={axis}
        start="subject"
        end="drawing"
        resize={{ target: "end", defaultSize: 500, minSize: 260, minOtherSize: 560 }}
      />,
    );
    const split = container.firstElementChild as HTMLElement;
    expect(split.style[axis === "horizontal" ? "gridTemplateColumns" : "gridTemplateRows"]).toBe(
      "minmax(0, 1fr) var(--gutter) var(--pane-size)",
    );
    const style = getComputedStyle(split);
    const size = parseFloat(style.getPropertyValue("--pane-size"));
    expect(size).toBe(332);
    expect(
      split.getBoundingClientRect()[axis === "horizontal" ? "width" : "height"] -
        parseFloat(style.getPropertyValue("--gutter")) -
        size,
    ).toBe(560);
    const seam = screen.getByRole("separator");
    const handles = [...seam.querySelectorAll<HTMLElement>("[data-slot='pane-resize-grip']")];
    expect(handles.map((el) => el.dataset.corner)).toEqual(["center"]);
    const offset = handles[0]!.style[axis === "horizontal" ? "top" : "left"];
    expect(
      [600, 567].map((size) => parseFloat(offset) * (offset.endsWith("%") ? size / 100 : 1)),
    ).toEqual([300, 283.5]);
    expect(handles.every((el) => el.parentElement === seam)).toBe(true);
  },
);

test("20 drag steps preview geometry without React commits, then commit once without remounting", () => {
  measure(900);
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const storage = { getItem: () => null, setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  const commits = vi.fn();
  const pictureCommits = vi.fn();
  const { container } = render(
    <Profiler id="split" onRender={commits}>
      <PaneSplit
        axis="horizontal"
        start={
          <Profiler id="picture" onRender={pictureCommits}>
            <Pane picture legend={null}>
              <canvas />
            </Pane>
          </Profiler>
        }
        end="chat"
        resize={{
          target: "end",
          defaultSize: 500,
          minSize: 260,
          minOtherSize: 560,
          persist: "stillness",
        }}
      />
    </Profiler>,
  );
  const canvas = container.querySelector("canvas");
  const split = container.querySelector<HTMLElement>('[data-slot="pane-split"]')!;
  const picture = container.querySelector<HTMLElement>("[data-picture]")!;
  // jsdom supplies no layout/ResizeObserver: deliver the canvas consumer's measured size.
  const widthReads = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(
      () =>
        parseFloat(picture.style.width) ||
        892 - parseFloat(split.style.getPropertyValue("--pane-size")),
    );
  const heightReads = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  const computedReads = vi.spyOn(window, "getComputedStyle");
  const rectReads = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  const setSize = vi.fn((width: number) => {
    canvas!.width = width;
    canvas!.height = 600;
  });
  const observed = () => {
    if (canvas!.width !== canvas!.clientWidth) setSize(canvas!.clientWidth);
  };
  observed();
  setSize.mockClear();
  const handle = screen.getByRole("separator");
  expect(pictureCommits.mock.calls.length).toBeGreaterThan(0);
  fireEvent.pointerDown(handle.firstElementChild!, { clientX: 600 });
  expect(handle.setPointerCapture).toHaveBeenCalledOnce();
  commits.mockClear();
  pictureCommits.mockClear();
  for (let step = 1; step <= 20; step++) {
    for (const read of [widthReads, heightReads, computedReads, rectReads]) read.mockClear();
    fireEvent.pointerMove(handle, { clientX: 600 + step });
    act(() => vi.advanceTimersToNextFrame());
    expect(
      [widthReads, heightReads, computedReads, rectReads].map((read) => read.mock.calls.length),
    ).toEqual([0, 0, 0, 0]);
    observed();
  }
  expect(commits).not.toHaveBeenCalled();
  expect(split.style.getPropertyValue("--pane-size")).toBe("312px");
  expect(setSize).not.toHaveBeenCalled();
  expect(parseFloat(picture.style.scale)).toBeCloseTo(580 / 560);
  fireEvent.pointerUp(handle);
  observed();
  expect(setSize).toHaveBeenCalledExactlyOnceWith(580);
  expect(commits).toHaveBeenCalledTimes(1);
  expect(pictureCommits).not.toHaveBeenCalled();
  expect(container.querySelector("canvas")).toBe(canvas);
  expect(getComputedStyle(split).getPropertyValue("--pane-size")).toBe("312px");
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith("stillness", "312");
});

test.each([true, false])(
  "a narrow split yields with rail=%s, then restores its mounted contents",
  async (rail) => {
    measure(600);
    let resized: (entries: { contentRect: DOMRect }[]) => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: typeof resized) {}
        observe(element: HTMLElement) {
          if (element.getAttribute("data-slot") === "pane-split") resized = this.callback;
        }
        disconnect() {}
        unobserve() {}
      },
    );
    function Dock() {
      const [collapsed, onCollapsedChange] = useState<"start" | "end" | null>(null);
      return (
        <PaneSplit
          axis="horizontal"
          start="subject"
          end={<input aria-label="draft" defaultValue="kept" />}
          resize={{
            target: "end",
            defaultSize: 300,
            minSize: 300,
            minOtherSize: 400,
            collapse: rail ? { collapsed, onCollapsedChange, end: { title: "thread" } } : undefined,
          }}
        />
      );
    }
    const { container } = render(<Dock />);
    await act(async () => {}); // Activity prepares initially folded content at background priority.
    const input = container.querySelector<HTMLInputElement>('input[aria-label="draft"]')!;
    expect(input).not.toBeNull();
    const split = container.firstElementChild as HTMLElement;
    if (rail) {
      expect(input.closest(".hidden")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Expand thread" }));
      expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
    } else {
      expect(split.dataset.axis).toBe("vertical");
      expect(split.style.gridTemplateRows).toBe("minmax(0, 1fr) var(--gutter) minmax(0, 1fr)");
      expect(screen.queryByRole("separator")).toBeNull();
    }
    act(() => resized([{ contentRect: new DOMRect(0, 0, 1200, 600) }]));
    expect(split.dataset.axis).toBe("horizontal");
    expect(screen.getByRole("textbox", { name: "draft" })).toBe(input);
    expect(input.getAttribute("value")).toBe("kept");
    expect(screen.getByRole("separator")).toBeTruthy();
  },
);

test("an unset other-side floor is the sized side's: too narrow for both stacks, never a sliver", () => {
  // The entity split (route/entity.tsx): a 320px plan beside the table, in a 570px tool.
  measure(570);
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start="table"
      end="plan"
      resize={{ target: "end", defaultSize: 520, minSize: 320 }}
    />,
  );
  const split = container.firstElementChild as HTMLElement;
  expect(split.dataset.axis).toBe("vertical");
  // Wide enough for both floors: side by side, and the table keeps 320 of 900.
  cleanup();
  vi.restoreAllMocks();
  measure(900);
  const wide = render(
    <PaneSplit
      axis="horizontal"
      start="table"
      end="plan"
      resize={{ target: "end", defaultSize: 800, minSize: 320 }}
    />,
  ).container.firstElementChild as HTMLElement;
  expect(wide.dataset.axis).toBe("horizontal");
  expect(parseFloat(getComputedStyle(wide).getPropertyValue("--pane-size"))).toBe(900 - 8 - 320);
});

test("container fitting restores the preferred size when room returns without persisting the fit", () => {
  measure(1200);
  let resized: (entries: { contentRect: DOMRect }[]) => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resized) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const storage = { getItem: () => "600", setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  const view = render(
    <PaneSplit
      axis="horizontal"
      start="subject"
      end="support"
      resize={{ target: "end", defaultSize: 500, minSize: 280, minOtherSize: 280, persist: "fit" }}
    />,
  );
  const split = view.container.firstElementChild as HTMLElement;
  const width = (value: number) =>
    act(() => resized([{ contentRect: new DOMRect(0, 0, value, 600) }]));
  width(700);
  expect(split.style.getPropertyValue("--pane-size")).toBe("412px");
  width(1200);
  expect(split.style.getPropertyValue("--pane-size")).toBe("600px");
  expect(storage.setItem).not.toHaveBeenCalled();
});

test("either side folds only to its rail under its floor, and the seam keeps the other open", () => {
  // The Pea dock (workbench/route-panes.tsx): Pea folds under 280, the tools under 420.
  measure(1200);
  const onCollapsedChange = vi.fn();
  function Dock({ collapsed }: { collapsed: "start" | "end" | null }) {
    return (
      <PaneSplit
        axis="horizontal"
        start="pea"
        end="tools"
        resize={{
          target: "end",
          defaultSize: 600,
          minSize: 420,
          minOtherSize: 280,
          collapse: {
            collapsed,
            onCollapsedChange,
            start: { title: "pea" },
            end: { title: "tools" },
          },
        }}
      />
    );
  }
  const view = render(<Dock collapsed={null} />);
  const seam = screen.getByRole("separator");
  const press = (key: string, times: number) => {
    for (let i = 0; i < times; i++) fireEvent.keyDown(seam, { key });
  };
  // Tools 600: under 420 folds the tools, never a narrower tools column.
  press("ArrowRight", 12);
  expect(onCollapsedChange).toHaveBeenLastCalledWith("end");
  onCollapsedChange.mockClear();
  // From tools 424: Pea (1192 - tools) under 280 folds Pea.
  press("ArrowLeft", 31);
  expect(onCollapsedChange).toHaveBeenLastCalledWith("start");
  const split = view.container.firstElementChild as HTMLElement;
  view.rerender(<Dock collapsed="start" />);
  expect(split.style.gridTemplateColumns).toBe(
    "calc(var(--control-h) + var(--gutter)) var(--gutter) minmax(0, 1fr)",
  );
  expect(screen.getByRole("button", { name: "Expand pea" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Expand tools" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand pea" }));
  expect(onCollapsedChange).toHaveBeenLastCalledWith(null);
  view.rerender(<Dock collapsed="end" />);
  expect(split.style.gridTemplateColumns).toBe(
    "minmax(0, 1fr) var(--gutter) calc(var(--control-h) + var(--gutter))",
  );
});

test.each(["start", "end"] as const)(
  "under both floors the last-focused %s side wins, and rail expansion swaps without remounting",
  (focused) => {
    measure(1200);
    let resized: (entries: { contentRect: DOMRect }[]) => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: typeof resized) {}
        observe(element: HTMLElement) {
          if (element.dataset.slot === "pane-split") resized = this.callback;
        }
        disconnect() {}
      },
    );
    function Dock() {
      const [collapsed, onCollapsedChange] = useState<"start" | "end" | null>(null);
      return (
        <PaneSplit
          axis="horizontal"
          start={<input aria-label="pea" defaultValue="unsent" />}
          end={<input aria-label="tools" defaultValue="retained" />}
          resize={{
            target: "end",
            defaultSize: 600,
            minSize: 420,
            minOtherSize: 280,
            collapse: {
              collapsed,
              onCollapsedChange,
              start: { title: "pea" },
              end: { title: "tools" },
            },
          }}
        />
      );
    }
    const view = render(<Dock />);
    const pea = screen.getByRole("textbox", { name: "pea" });
    const tools = screen.getByRole("textbox", { name: "tools" });
    fireEvent.focus(focused === "start" ? pea : tools);
    const width = (value: number) =>
      act(() => resized([{ contentRect: new DOMRect(0, 0, value, 600) }]));
    width(708); // The seam plus both floors fits exactly.
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    width(707);
    expect((focused === "start" ? tools : pea).closest(".hidden")).toBeTruthy();
    for (let swap = 0; swap < 4; swap++) {
      fireEvent.click(screen.getByRole("button", { name: /Expand/ }));
      expect([pea, tools].filter((input) => !input.closest(".hidden"))).toHaveLength(1);
      expect(view.container.querySelectorAll('[data-slot="pane-rail"]')).toHaveLength(1);
      width(500); // A repeated constrained measurement cannot override the person's expansion.
      expect([pea, tools].filter((input) => !input.closest(".hidden"))).toHaveLength(1);
    }
    width(1200);
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));
    expect(screen.getByRole("textbox", { name: "pea" })).toBe(pea);
    expect(screen.getByRole("textbox", { name: "tools" })).toBe(tools);
    expect((pea as HTMLInputElement).value).toBe("unsent");
    expect((tools as HTMLInputElement).value).toBe("retained");
  },
);
