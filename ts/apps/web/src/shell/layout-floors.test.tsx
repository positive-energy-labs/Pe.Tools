// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  GraphLayoutView,
  type PaneApi,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { ductsGraph } from "#/ducts/graph";
import { opsGraph } from "#/ops/graph";
import { PaneSplit } from "../../../../packages/kit/src/components/lang/pane-resize";

beforeEach(() => {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    const get = style.getPropertyValue.bind(style);
    vi.spyOn(style, "getPropertyValue").mockImplementation((name) =>
      name === "--gutter" ? "8px" : get(name),
    );
    return style;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

for (const width of [720, 1280, 1920]) {
  for (const stage of ["network", "sheet"] as const) {
    test(`ducts ${stage} at ${width}px keeps subject floors or named rails`, () => {
      document.documentElement.style.setProperty("--gutter", "8px");
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, width, 900),
      );
      const bodies = Object.fromEntries(
        Object.keys(ductsGraph.panes).map((id) => [id, (frame: PaneApi) => frame(id)]),
      );
      const { container } = render(
        <GraphLayoutView
          layout={ductsGraph.layout}
          panes={ductsGraph.panes}
          active={(key) => key === stage || key === "system"}
          bodies={bodies}
        />,
      );
      const id = stage === "network" ? "sidebar" : "sheet-layout";
      const split = [...container.querySelectorAll<HTMLElement>("[data-layout-split]")].find((el) =>
        el.dataset.layoutSplit?.startsWith(`["${id}",`),
      )!;
      expect(split).toBeTruthy();
      expect(split.dataset.paneStacked).toBeUndefined();
      const size = Number.parseFloat(split.style.getPropertyValue("--pane-size"));
      expect(size).toBeGreaterThanOrEqual(280);
      expect(width - 8 - size).toBeGreaterThanOrEqual(stage === "network" ? 400 : 360);
    });
  }
  test(`ops retains its panes at ${width}px`, () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, width, 900),
    );
    const bodies = Object.fromEntries(
      Object.keys(opsGraph.panes).map((id) => [id, (frame: PaneApi) => frame(id)]),
    );
    const { container } = render(
      <GraphLayoutView
        layout={opsGraph.layout}
        panes={opsGraph.panes}
        active={() => true}
        bodies={bodies}
      />,
    );
    expect(container.querySelector('[data-pane-id="operation"]')).toBeTruthy();
    expect(container.querySelector('[data-pane-id="receipts"]')).toBeTruthy();
  });
}

test("persisted widths fit around the network drawing floors", () => {
  document.documentElement.style.setProperty("--gutter", "8px");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 720, 900),
  );
  const bodies = Object.fromEntries(
    Object.keys(ductsGraph.panes).map((id) => [id, (frame: PaneApi) => frame(id)]),
  );
  const { container } = render(
    <GraphLayoutView
      layout={ductsGraph.layout}
      panes={ductsGraph.panes}
      active={(key) => key === "network" || key === "system"}
      bodies={bodies}
      state={{
        panes: { "e-inbox": { sizes: { '["drawing","e-inbox"]': 900 } } },
        onChange: () => {},
      }}
    />,
  );
  const drawing = [...container.querySelectorAll<HTMLElement>("[data-layout-split]")].find(
    (el) => el.dataset.layoutSplit === '["drawing","e-inbox"]',
  )!;
  const size = Number.parseFloat(drawing.style.getPropertyValue("--pane-size"));
  expect(size).toBeGreaterThanOrEqual(260);
  expect(720 - 8 - size).toBeGreaterThanOrEqual(360);
});

test("folding a leaf does not fold its containing support branch", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1920, 1080),
  );
  const { container } = render(
    <GraphLayoutView
      layout={ductsGraph.layout}
      panes={ductsGraph.panes}
      active={(key) => key === "network" || key === "system"}
      bodies={Object.fromEntries(
        Object.keys(ductsGraph.panes).map((id) => [id, (frame: PaneApi) => frame(id)]),
      )}
      state={{ panes: { "e-systems": { folded: true } }, onChange: () => {} }}
    />,
  );
  const sidebar = [...container.querySelectorAll<HTMLElement>("[data-layout-split]")].find(
    (node) => node.dataset.layoutSplit === '["sidebar","e-systems"]',
  )!;
  expect(sidebar.dataset.paneFolded).toBeUndefined();
});

for (const width of [900, 1280]) {
  test(`outer split lets nested Rulings yield through vertical wrappers at ${width}px`, () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, width, 900),
    );
    const changed = vi.fn();
    const { container } = render(
      <PaneSplit
        id="outer"
        axis="horizontal"
        start="chat"
        resize={{ target: "end", defaultSize: 420, size: 1, minSize: 280, minOtherSize: 280 }}
        end={
          <div>
            <PaneSplit
              axis="vertical"
              start="header"
              end={
                <PaneSplit
                  axis="horizontal"
                  start="Picture"
                  end="Rulings"
                  resize={{
                    target: "end",
                    defaultSize: 340,
                    minSize: 260,
                    minOtherSize: 360,
                    collapse: {
                      collapsed: null,
                      onCollapsedChange: changed,
                      end: { title: "Rulings" },
                    },
                  }}
                />
              }
            />
          </div>
        }
      />,
    );
    const outer = container.querySelector<HTMLElement>('[data-layout-split="outer"]')!;
    expect(outer.style.getPropertyValue("--pane-size")).toBe(width < 916 ? "400px" : "628px");
    expect(outer.dataset.paneStacked).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });
}

for (const size of [0, 10000]) {
  test(`an open split with unspecified floors cannot persist a zero track from ${size}`, () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 900),
    );
    const { container } = render(
      <PaneSplit
        axis="horizontal"
        start="Subject"
        end="Support"
        resize={{ target: "end", defaultSize: 300, size, minSize: 0 }}
      />,
    );
    const rendered = Number.parseFloat(
      container
        .querySelector<HTMLElement>('[data-slot="pane-split"]')!
        .style.getPropertyValue("--pane-size"),
    );
    expect(rendered).toBeGreaterThan(0);
    expect(900 - 8 - rendered).toBeGreaterThan(0);
  });
}
