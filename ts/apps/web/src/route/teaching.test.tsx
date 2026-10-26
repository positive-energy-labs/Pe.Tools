// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { actionScopeKeys, actionTeaching, chordLabel } from "@pe/kit/keys";
import {
  declaredTeaching,
  measureRegions,
  registerTeaching,
  type Teaching,
} from "@pe/kit/lang/teach";
import { TeachingLayoutView } from "@pe/kit/lang/teaching-layout";
import { TeachPage, TeachReference, TeachTarget, useTeaching } from "@pe/kit/lang/use-teach";
import { ductsPaneState, DUCTS_LAYOUT, DUCTS_TEACHING } from "#/ducts/proto/e/teaching";
import { STAGE_ACTIONS } from "#/scene/stage-teaching";
import { HelpWorld } from "./help";
import { STARTUP_TEACHING } from "./teaching";

afterEach(cleanup);

test("Ducts support folds retain the current width and last-focused priority policy", () => {
  const state = {
    inboxOpen: null,
    treeCollapsed: null,
    priority: "sidebar" as const,
    toRule: 1,
    staged: 0,
  };
  expect(ductsPaneState({ ...state, width: 1400 })).toEqual({
    sidebarCollapsed: false,
    inboxShown: true,
  });
  expect(ductsPaneState({ ...state, width: 900 })).toEqual({
    sidebarCollapsed: false,
    inboxShown: false,
  });
  expect(ductsPaneState({ ...state, width: 600 })).toEqual({
    sidebarCollapsed: true,
    inboxShown: false,
  });
  expect(ductsPaneState({ ...state, width: 900, inboxOpen: true, priority: "inbox" })).toEqual({
    sidebarCollapsed: true,
    inboxShown: true,
  });
  expect(ductsPaneState({ ...state, width: 900, inboxOpen: true })).toEqual({
    sidebarCollapsed: false,
    inboxShown: false,
  });
});

const twoRegions: Teaching[] = [
  { kind: "region", id: "a", label: "Systems", rect: { left: 0, top: 0, width: 200, height: 400 } },
  {
    kind: "region",
    id: "b",
    label: "Rulings",
    rect: { left: 200, top: 0, width: 400, height: 400 },
  },
];

test("the foldout shares identical keys once, retains their scopes, and separates changed refusals", () => {
  const keys = (region: string, scope: string, refusal?: string): Teaching => ({
    kind: "keys",
    id: region + ":keys",
    region,
    scope,
    items: [{ keys: ["ArrowDown"], label: "next", says: "Move the row cursor", refusal }],
  });
  const view = render(
    <HelpWorld facts={[...twoRegions, keys("a", "System tree"), keys("b", "Ruling list")]} />,
  );
  const shared = screen.getByRole("region", { name: "Shared controls" });
  expect(within(shared).getAllByText("Move the row cursor")).toHaveLength(1);
  expect(shared.textContent).toContain("Systems / System tree");
  expect(shared.textContent).toContain("Rulings / Ruling list");
  expect(screen.getByRole("region", { name: "Systems controls" }).textContent).not.toContain(
    "Move the row cursor",
  );
  fireEvent.click(screen.getByRole("button", { name: "Read Rulings controls" }));
  view.rerender(
    <HelpWorld
      facts={[
        ...twoRegions,
        keys("a", "System tree"),
        keys("b", "Ruling list", "Reading is pending"),
      ]}
    />,
  );
  expect(screen.getByRole("region", { name: "Shared controls" }).textContent).not.toContain(
    "Move the row cursor",
  );
  expect(screen.getByRole("region", { name: "Rulings controls" }).textContent).toContain(
    "refuses now: Reading is pending",
  );
  fireEvent.click(screen.getByRole("button", { name: "Show Systems controls" }));
  expect(screen.getByRole("region", { name: "Systems controls" }).textContent).not.toContain(
    "refuses now",
  );
});

test("selection falls back when facts change and empty maps do not retain region details", () => {
  const view = render(<HelpWorld facts={twoRegions} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Rulings controls" }));
  expect(
    view.container.querySelector("[data-teach-detail]")?.getAttribute("data-teach-detail"),
  ).toBe("b");
  view.rerender(<HelpWorld facts={[]} />);
  expect(view.container.querySelector("[data-teach-detail]")).toBeNull();
  view.rerender(<HelpWorld facts={STARTUP_TEACHING} />);
  expect(
    screen
      .getByRole("button", { name: "Read Global navigation controls" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    view.container.querySelector("[data-teach-detail]")?.getAttribute("data-teach-detail"),
  ).toBe("navigation");
});

test("shared reference and measured keys retain separate source groups", () => {
  const facts: Teaching[] = [...twoRegions];
  for (const source of ["reference", undefined] as const)
    for (const region of ["a", "b"])
      facts.push({
        kind: "keys",
        id: `${source}:${region}`,
        region,
        scope: "List",
        source,
        items: [{ keys: ["ArrowDown"], label: "next", says: "Move the row cursor" }],
      });
  render(<HelpWorld facts={facts} />);
  expect(
    within(screen.getByRole("region", { name: "Shared controls" })).getAllByText(
      "Move the row cursor",
    ),
  ).toHaveLength(2);
});

test("selected reference follows real fields and mode state without calling unknown views available", () => {
  const controls = (active?: boolean, disabled?: boolean): Teaching[] => [
    ...twoRegions,
    {
      kind: "search",
      id: "search",
      region: "b",
      label: "Find",
      syntax: ["Words match rows"],
      fields: [{ label: "Size", operators: [">"], examples: ["Size > 10"] }],
    },
    {
      kind: "views",
      id: "layers",
      region: "b",
      label: "layers",
      options: [{ key: "context", label: "Context", active, disabled }],
    },
  ];
  const view = render(<HelpWorld facts={controls()} />);
  fireEvent.click(screen.getByRole("button", { name: "Read Rulings controls" }));
  const detail = screen.getByRole("region", { name: "Rulings controls" });
  expect(detail.textContent).toContain("Size > 10");
  expect(detail.textContent).not.toContain("available");
  view.rerender(<HelpWorld facts={controls(true)} />);
  expect(detail.textContent).toContain("Context · shown");
  view.rerender(<HelpWorld facts={controls(false, true)} />);
  expect(within(detail).getByLabelText("Context").getAttribute("aria-disabled")).toBe("true");
  expect(detail.textContent).not.toContain("available");
});

test("changing the shared action changes reference and actual scoped bindings together", () => {
  const action = {
    ...STAGE_ACTIONS.frame,
    label: "changed frame",
    bindings: ["Shift+F" as const],
    invoke: vi.fn(),
  };
  const [reference] = actionTeaching([action]);
  const [live] = actionScopeKeys([action]);
  expect(reference).toEqual({
    keys: [chordLabel(live!.hotkey)],
    label: live!.label,
    says: live!.says,
  });
  expect(reference!.keys).not.toEqual(actionTeaching([STAGE_ACTIONS.frame])[0]!.keys);
  expect(action.invoke).not.toHaveBeenCalled();
});

test("a shared split change reaches the rendered layout and reference rectangles", () => {
  const layout = {
    ...DUCTS_LAYOUT,
    size: 512,
    start: { ...DUCTS_LAYOUT.start, axis: "horizontal" as const },
  };
  const reference = declaredTeaching(layout);
  expect(reference.find((f) => f.kind === "region" && f.id === "e-rules-all")).toMatchObject({
    rect: { left: 336, top: 0, width: 88 },
  });
  const html = renderToStaticMarkup(
    <TeachingLayoutView<typeof layout>
      layout={layout}
      content={{
        "e-systems": (pane) => pane("systems"),
        "e-sidebar": (pane) => pane("tree"),
        "e-inputs": (pane) => pane("inputs"),
        "e-rules-all": (pane) => pane("rules"),
        "e-rules": (pane) => pane("selected rules"),
        "e-picture": (pane) => pane("picture"),
        "e-inbox": (pane) => pane("rulings"),
      }}
      state={{
        conditions: {
          system: { available: true },
          tree: { available: true },
          tight: { available: false },
        },
        // Render the tree side: folded Activity content is intentionally absent from SSR.
        choices: { scope: { value: "end", onChange: () => {} } },
        folds: {
          sidebar: { collapsed: null, onChange: () => {} },
          drawing: { collapsed: null, onChange: () => {} },
          inputs: { collapsed: "end", onChange: () => {} },
        },
      }}
    />,
  );
  expect(html).toContain("512px");
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(
    [...container.querySelectorAll("[data-slot=pane-split]")].map((node) =>
      node.getAttribute("data-axis"),
    ),
  ).toEqual(["horizontal", "horizontal", "horizontal", "vertical", "horizontal", "horizontal"]);
});

test("reference projection removes runtime claims even from an accidentally stateful declaration", () => {
  const facts = declaredTeaching({
    id: "one",
    label: "One",
    controls: [
      {
        kind: "views",
        label: "layers",
        options: [{ key: "x", label: "X", active: true, disabled: true }],
      },
      {
        kind: "keys",
        scope: "One",
        items: [{ keys: ["F"], label: "frame", refusal: "No document" }],
      },
    ],
  });
  expect(facts[1]).toMatchObject({ options: [{ key: "x", label: "X" }] });
  expect(JSON.stringify(facts)).not.toMatch(/active|disabled|refusal/);
});

function Tutorial() {
  return <HelpWorld facts={useTeaching()} />;
}

test("measured shell panes cannot replace a route's still-loading declaration", () => {
  const withdraw = registerTeaching({
    kind: "region",
    id: "chat",
    label: "Chat",
    rect: { left: 0, top: 0, width: 400, height: 600 },
  });
  const view = render(
    <TeachTarget value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachTarget>,
  );
  expect(view.container.querySelector("[data-teach-source=reference]")).toBeTruthy();
  expect(view.container.textContent).toContain("All-systems rules");
  expect(view.container.textContent).not.toContain("Chat");
  act(withdraw);
});
test("empty measurements keep the reference; route changes exclude another retained page", () => {
  const a: Teaching = {
    kind: "region",
    id: "live",
    label: "Measured ducts",
    page: "/ducts",
    rect: { left: 0, top: 0, width: 500, height: 300 },
  };
  const withdraw = registerTeaching(a);
  const view = render(
    <TeachPage value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.textContent).toContain("Measured ducts");
  view.rerender(
    <TeachPage value="/family">
      <TeachReference value={STARTUP_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.textContent).not.toContain("Measured ducts");
  expect(view.container.textContent).toContain("Workspace");
  act(withdraw);
  view.rerender(
    <TeachPage value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.querySelector("[data-teach-source=reference]")).toBeTruthy();
  expect(view.container.textContent).toContain("All-systems rules");
});

test("a local chat tutorial owns its measured facts while tool chrome keeps the current tool", () => {
  const withdrawals = [
    registerTeaching({
      kind: "region",
      id: "tool",
      label: "Measured ducts",
      page: "/ducts",
      rect: { left: 0, top: 0, width: 500, height: 300 },
    }),
    registerTeaching({
      kind: "region",
      id: "chat",
      label: "Measured Pea",
      page: "/pea",
      rect: { left: 500, top: 0, width: 400, height: 300 },
    }),
  ];
  const view = render(
    <TeachTarget value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <div data-reader="tool">
          <Tutorial />
        </div>
        <TeachPage value="/pea">
          <TeachReference value={STARTUP_TEACHING}>
            <div data-reader="chat">
              <Tutorial />
            </div>
          </TeachReference>
        </TeachPage>
      </TeachReference>
    </TeachTarget>,
  );
  expect(view.container.querySelector('[data-reader="tool"]')!.textContent).toContain(
    "Measured ducts",
  );
  expect(view.container.querySelector('[data-reader="chat"]')!.textContent).toContain(
    "Measured Pea",
  );
  expect(view.container.querySelector('[data-reader="chat"]')!.textContent).not.toContain(
    "Measured ducts",
  );
  act(() => withdrawals.forEach((withdraw) => withdraw()));
  expect(view.container.querySelector('[data-reader="chat"]')!.textContent).toContain("Workspace");
  expect(view.container.querySelector('[data-reader="chat"]')!.textContent).not.toContain(
    "All-systems rules",
  );
});

test("SSR never reads the process-global mounted registry and hydrates the same map without warnings", async () => {
  const withdraw = registerTeaching({
    kind: "region",
    id: "secret",
    label: "Another request's document",
    rect: { left: 0, top: 0, width: 1, height: 1 },
  });
  const content = (
    <TeachReference value={STARTUP_TEACHING}>
      <Tutorial />
    </TeachReference>
  );
  const html = renderToString(content);
  withdraw();
  expect(html).not.toContain("Another request");
  expect(html).toContain("data-page-map");
  expect(html).toContain('data-map-region="navigation"');
  expect(html).toContain("aspect-ratio:1440 / 800");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, content);
  });
  expect(errors.mock.calls).toEqual([]);
  act(() => root.unmount());
  container.remove();
  errors.mockRestore();
});

test("current pane and covering rail geometry share one workspace origin", () => {
  const facts: Teaching[] = [
    {
      kind: "region",
      id: "picture",
      label: "Picture",
      rect: { left: 132, top: 80, width: 600, height: 400 },
    },
    ...["tree", "inputs"].map(
      (id): Teaching => ({
        kind: "region",
        id,
        label: id,
        visibility: "folded",
        foldedBy: ["sidebar"],
        rail: {
          id: "sidebar:start",
          orientation: "vertical",
          label: "Systems",
          rect: { left: 100, top: 80, width: 32, height: 400 },
        },
      }),
    ),
  ];
  const picture = measureRegions(facts);
  expect(picture.regions[0]).toMatchObject({ left: 32, top: 0 });
  expect(picture.rails).toHaveLength(1);
  expect(picture.rails[0]).toMatchObject({ left: 0, top: 0, width: 32, height: 400 });
  expect(picture).toMatchObject({ width: 632, height: 400 });
});
test("described hidden controls do not downgrade observed workspace geometry", () => {
  const view = render(
    <HelpWorld
      facts={[
        ...twoRegions,
        {
          kind: "region",
          id: "hidden",
          label: "Inputs",
          visibility: "folded",
          available: false,
          refusal: "Choose a system",
          foldedBy: ["sidebar"],
        },
        {
          kind: "keys",
          id: "described",
          region: "hidden",
          scope: "Inputs",
          source: "reference",
          items: [{ keys: ["F"], label: "frame" }],
        },
      ]}
    />,
  );
  expect(
    view.container.querySelector("[data-teach-source]")?.getAttribute("data-teach-source"),
  ).toBe("measured");
  expect(screen.getByRole("button", { name: "Read Inputs controls" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Read Inputs controls" }));
  expect(screen.getByRole("region", { name: "Inputs controls" }).textContent).toContain(
    "Declared controls",
  );
  expect(view.container.textContent).toContain("Folded in workspace");
  expect(view.container.textContent).toContain("Choose a system");
});

test("a folded composition pane keeps described controls even while retained bindings exist", () => {
  const withdraw = registerTeaching([
    {
      kind: "region",
      id: "instance:hidden",
      region: "instance:hidden",
      node: "hidden",
      instance: "instance",
      instanceVisible: true,
      page: "/folded",
      label: "Hidden",
      visibility: "folded",
    },
    {
      kind: "keys",
      id: "described",
      region: "instance:hidden",
      instance: "instance",
      page: "/folded",
      source: "reference",
      scope: "Hidden",
      items: [{ keys: ["F"], label: "Described frame" }],
    },
    {
      kind: "keys",
      id: "retained",
      region: "instance:hidden",
      instance: "instance",
      page: "/folded",
      scope: "Hidden",
      items: [{ keys: ["F"], label: "Retained binding" }],
    },
  ]);
  try {
    const view = render(
      <TeachPage value="/folded">
        <Tutorial />
      </TeachPage>,
    );
    expect(view.container.textContent).toContain("Described frame");
    expect(view.container.textContent).not.toContain("Retained binding");
    expect(view.container.querySelector('[data-teach-node="hidden"]')).not.toBeNull();
  } finally {
    act(withdraw);
  }
});
