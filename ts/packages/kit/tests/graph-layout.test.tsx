// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { gate, pane, split, type LayoutNode, type PaneDecl } from "@pe/agent-contracts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  GraphLayoutView,
  type GraphLayoutState,
  type PaneApi,
} from "../src/components/lang/graph-layout";
import { readTeaching } from "@pe/kit/lang/teach";
import { TeachPage } from "@pe/kit/lang/use-teach";

const panes = {
  plan: { label: "Plan", purpose: "See the room boundaries.", draws: [], verbs: [] },
  inbox: { label: "Review inbox", purpose: "Review proposed changes.", draws: [], verbs: [] },
  regions: { label: "Regions", purpose: "Choose a region.", draws: [], verbs: [] },
} satisfies Record<string, PaneDecl>;
const layout = split(
  "working",
  { axis: "h", sized: "start", size: 320 },
  pane("plan"),
  split(
    "review",
    { axis: "v", sized: "start", size: 8 },
    gate("review", pane("inbox")),
    pane("regions"),
  ),
);
const bodies = Object.fromEntries(
  Object.keys(panes).map((id) => [id, (pane: PaneApi) => pane(`${id} body`)]),
);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 600),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(readTeaching()).toEqual([]);
});

test("the reduced three-pane tree teaches declared labels and purpose through the real renderer", () => {
  const view = render(
    <TeachPage value="/rooms">
      <GraphLayoutView layout={layout} panes={panes} active={() => false} bodies={bodies} />
    </TeachPage>,
  );
  expect(view.container.querySelector('[data-pane-id="inbox"]')).toBeNull();
  expect(view.container.querySelectorAll("[data-layout-split]")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Plan" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Regions" })).toBeTruthy();
  const inventory = readTeaching().filter((fact) => fact.kind === "region");
  expect(inventory).toHaveLength(2);
  expect(inventory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        node: "plan",
        label: panes.plan.label,
        purpose: panes.plan.purpose,
        page: "/rooms",
      }),
      expect.objectContaining({
        node: "regions",
        label: panes.regions.label,
        purpose: panes.regions.purpose,
        page: "/rooms",
      }),
    ]),
  );
});

function Consumer({ controlled = false }: { controlled?: boolean }) {
  const [review, setReview] = useState(true);
  const [state, setState] = useState<GraphLayoutState>({});
  return (
    <>
      <button onClick={() => setReview((value) => !value)}>Toggle review</button>
      <GraphLayoutView
        layout={layout}
        panes={panes}
        active={() => review}
        bodies={bodies}
        state={controlled ? { panes: state, onChange: setState } : undefined}
      />
      <output data-state="">{JSON.stringify(state)}</output>
    </>
  );
}

test.each([false, true])(
  "fold state survives gate removal and return (controlled=%s)",
  (controlled) => {
    const view = render(<Consumer controlled={controlled} />);
    const seam = () =>
      screen
        .getAllByRole("separator")
        .find((node) => node.getAttribute("aria-orientation") === "horizontal")!;
    fireEvent.keyDown(seam(), { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "Expand Review inbox" })).toBeTruthy();
    fireEvent.click(screen.getByText("Toggle review"));
    expect(view.container.querySelector('[data-pane-id="inbox"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand Review inbox" })).toBeNull();
    fireEvent.click(screen.getByText("Toggle review"));
    expect(screen.getByRole("button", { name: "Expand Review inbox" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Review inbox" }));
    expect(screen.getByRole("region", { name: "Review inbox" })).toBeTruthy();
    if (controlled) {
      expect(JSON.parse(view.container.querySelector("[data-state]")!.textContent!)).toMatchObject({
        inbox: { folded: false },
      });
    }
  },
);

test.each([false, true])(
  "a chosen size returns after its split was removed (controlled=%s)",
  (controlled) => {
    const view = render(<Consumer controlled={controlled} />);
    const seam = () =>
      screen
        .getAllByRole("separator")
        .find((node) => node.getAttribute("aria-orientation") === "horizontal")!;
    fireEvent.keyDown(seam(), { key: "ArrowDown" });
    expect(seam().getAttribute("aria-valuenow")).toBe("24");
    fireEvent.click(screen.getByText("Toggle review"));
    expect(view.container.querySelector('[data-pane-id="inbox"]')).toBeNull();
    fireEvent.click(screen.getByText("Toggle review"));
    expect(seam().getAttribute("aria-valuenow")).toBe("24");
  },
);

test("a resize can expand a folded pane and commit its size in the same event", () => {
  const view = render(<Consumer controlled />);
  const seam = () =>
    screen
      .getAllByRole("separator")
      .find((node) => node.getAttribute("aria-orientation") === "horizontal")!;
  fireEvent.keyDown(seam(), { key: "ArrowUp" });
  expect(screen.getByRole("button", { name: "Expand Review inbox" })).toBeTruthy();
  fireEvent.keyDown(seam(), { key: "ArrowDown" });
  expect(screen.queryByRole("button", { name: "Expand Review inbox" })).toBeNull();
  expect(seam().getAttribute("aria-valuenow")).toBe("24");
  expect(JSON.parse(view.container.querySelector("[data-state]")!.textContent!)).toMatchObject({
    inbox: { folded: false, sizes: { '["review","inbox"]': 24 } },
  });
  fireEvent.click(screen.getByText("Toggle review"));
  fireEvent.click(screen.getByText("Toggle review"));
  expect(screen.getByRole("region", { name: "Review inbox" })).toBeTruthy();
  expect(seam().getAttribute("aria-valuenow")).toBe("24");
});

test.each(["start", "end"] as const)(
  "ordered n-ary splits reuse binary PaneSplit seams (%s)",
  (sized) => {
    const many = split(
      "many",
      { axis: "h", sized, size: 200 },
      pane("plan"),
      pane("inbox"),
      pane("regions"),
    );
    const view = render(
      <GraphLayoutView layout={many} panes={panes} active={() => true} bodies={bodies} />,
    );
    expect(
      [...view.container.querySelectorAll<HTMLElement>("[data-pane-id]")].map(
        (node) => node.dataset.paneId,
      ),
    ).toEqual(["plan", "inbox", "regions"]);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  },
);

test("an empty projection removes all regions and can mount again", () => {
  const conditional: LayoutNode = gate("show", layout);
  const view = render(
    <GraphLayoutView layout={conditional} panes={panes} active={() => true} bodies={bodies} />,
  );
  expect(view.container.querySelectorAll("[data-pane-id]")).toHaveLength(3);
  view.rerender(
    <GraphLayoutView layout={conditional} panes={panes} active={() => false} bodies={bodies} />,
  );
  expect(view.container.innerHTML).toBe("");
  expect(readTeaching()).toEqual([]);
  view.rerender(
    <GraphLayoutView layout={conditional} panes={panes} active={() => true} bodies={bodies} />,
  );
  expect(view.container.querySelectorAll("[data-pane-id]")).toHaveLength(3);
});
