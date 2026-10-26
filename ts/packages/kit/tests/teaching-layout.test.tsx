// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { TeachingLayoutView, type TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { declaredTeaching, readTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { TeachPage, TeachReference, useTeaching } from "@pe/kit/lang/use-teach";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(readTeaching()).toEqual([]);
});
const layout = {
  id: "scope",
  axis: "horizontal",
  target: "end",
  size: 32,
  minSize: 32,
  choice: "scope",
  rails: { start: { title: "All" }, end: { title: "System" } },
  start: { id: "all", label: "All systems" },
  end: {
    id: "system",
    axis: "vertical",
    target: "end",
    size: 220,
    minSize: 100,
    minOtherSize: 100,
    available: "system",
    rails: { end: { title: "Inputs" } },
    start: { id: "tree", label: "System tree", mount: "system", available: "system" },
    end: { id: "inputs", label: "Inputs", mount: "system", available: "system" },
  },
} as const satisfies TeachingLayout;
function Probe() {
  return <output data-probe="">{JSON.stringify(useTeaching())}</output>;
}
const facts = (container: HTMLElement) =>
  JSON.parse(container.querySelector("[data-probe]")!.textContent!);
test("the actual split machine retains full inventory across availability and nested folds", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 600),
  );
  const inputs = vi.fn((pane: TeachingPaneRender) => pane("input content"));
  function Consumer() {
    const [available, setAvailable] = useState(false);
    const [side, setSide] = useState<"start" | "end">("start");
    const [folded, setFolded] = useState<"start" | "end" | null>("end");
    return (
      <TeachPage value="/test">
        <TeachReference value={declaredTeaching(layout)}>
          <button onClick={() => setAvailable(true)}>Choose system</button>
          <TeachingLayoutView<typeof layout>
            layout={layout}
            content={{
              all: (pane) => pane("all content"),
              tree: (pane) => pane("tree content"),
              inputs,
            }}
            state={{
              conditions: { system: { available, reason: "Choose a system" } },
              choices: { scope: { value: side, onChange: setSide } },
              folds: { system: { collapsed: folded, onChange: setFolded } },
            }}
          />
          <Probe />
        </TeachReference>
      </TeachPage>
    );
  }
  const view = render(<Consumer />);
  expect(facts(view.container).filter((f: { kind: string }) => f.kind === "region")).toHaveLength(
    3,
  );
  expect(facts(view.container).find((f: { id: string }) => f.id === "inputs")).toMatchObject({
    available: false,
    visibility: "folded",
    foldedBy: ["scope"],
  });
  expect(inputs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Choose system"));
  fireEvent.click(screen.getByRole("button", { name: "Expand System" }));
  await waitFor(() =>
    expect(facts(view.container).find((f: { id: string }) => f.id === "inputs")).toMatchObject({
      available: true,
      visibility: "folded",
      foldedBy: ["system"],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Expand Inputs" }));
  await waitFor(() =>
    expect(facts(view.container).find((f: { id: string }) => f.id === "inputs")).toMatchObject({
      visibility: "visible",
      foldedBy: [],
    }),
  );
  expect(inputs).toHaveBeenCalled();
});

test("live pane titles and list fallback change labels without changing semantic identity", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 400),
  );
  const one = { id: "stable", label: "Declared title" } as const;
  function Consumer() {
    const [title, setTitle] = useState("First system");
    const [header, setHeader] = useState(true);
    const current = { ...one, pane: { ...(header ? {} : { header: false as const }) } };
    return (
      <TeachPage value="/title">
        <TeachReference value={declaredTeaching(one)}>
          <button onClick={() => setTitle("Second system")}>Rename</button>
          <button onClick={() => setHeader(false)}>Use list name</button>
          <TeachingLayoutView<typeof current>
            layout={current}
            content={{
              stable: (pane) => pane(<div data-list-view="" aria-label="System runs" />, { title }),
            }}
          />
          <Probe />
        </TeachReference>
      </TeachPage>
    );
  }
  const view = render(<Consumer />);
  expect(facts(view.container)[0]).toMatchObject({ id: "stable", label: "First system" });
  fireEvent.click(screen.getByText("Rename"));
  await waitFor(() =>
    expect(facts(view.container)[0]).toMatchObject({
      id: "stable",
      label: "Second system",
      visibility: "visible",
    }),
  );
  fireEvent.click(screen.getByText("Use list name"));
  await waitFor(() =>
    expect(facts(view.container)[0]).toMatchObject({ id: "stable", label: "System runs" }),
  );
});

test("retained instances on one route cannot collide or replace the visible composition", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[data-inactive]") ? new DOMRect() : new DOMRect(0, 0, 600, 400);
    },
  );
  const one = { id: "stable", label: "Declared title" } as const;
  const view = render(
    <TeachPage value="/same">
      <TeachReference value={declaredTeaching(one)}>
        <div data-inactive="">
          <TeachingLayoutView<typeof one>
            layout={one}
            content={{ stable: (pane) => pane("retained", { title: "Retained" }) }}
          />
        </div>
        <TeachingLayoutView<typeof one>
          layout={one}
          content={{ stable: (pane) => pane("visible", { title: "Visible" }) }}
        />
        <Probe />
      </TeachReference>
    </TeachPage>,
  );
  expect(facts(view.container)).toHaveLength(1);
  expect(facts(view.container)[0]).toMatchObject({ id: "stable", label: "Visible" });
  const inventory = readTeaching().filter((fact) => fact.kind === "region" && fact.node);
  expect(new Set(inventory.map((fact) => fact.id)).size).toBe(2);
});

test("a branch payload cannot replace its declared split or descendant panes", () => {
  const replacement = vi.fn(() => "escaped topology");
  const content = {
    scope: replacement,
    all: (pane: TeachingPaneRender) => pane("all"),
    tree: (pane: TeachingPaneRender) => pane("tree"),
    inputs: (pane: TeachingPaneRender) => pane("inputs"),
  };
  const view = render(
    <TeachingLayoutView<typeof layout>
      layout={layout}
      content={content}
      state={{
        conditions: { system: { available: true } },
        choices: { scope: { value: "start", onChange: () => {} } },
        folds: { system: { collapsed: "end", onChange: () => {} } },
      }}
    />,
  );
  expect(replacement).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll("[data-layout-split]")).toHaveLength(2);
  expect(view.container.querySelectorAll("[data-pane-id]")).toHaveLength(3);
});
