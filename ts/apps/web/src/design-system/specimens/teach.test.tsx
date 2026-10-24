// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Pane } from "@pe/kit/lang/pane";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Switcher } from "@pe/kit/lang/switcher";
import { readTeaching, type Teaching } from "@pe/kit/lang/teach";
import { TeachRegion, useTeaching } from "@pe/kit/lang/use-teach";
import { KeyScope, useScopeKeys } from "@pe/kit/keys";
import { QueryBox } from "@pe/kit/table/query";
import { HelpWorld, RouteHelpButton } from "#/route/help";
import { ductsDocs } from "#/ducts/docs";
import { DUCTS_COMPARE } from "@pe/agent-contracts/ducts-guide";
const diagram = vi.hoisted(() => vi.fn(() => null));
vi.mock("#/product-map/diagram", async (original) => ({
  ...(await original<typeof import("#/product-map/diagram")>()),
  Mermaid: diagram,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
let enter: IntersectionObserverCallback[];
async function reveal() {
  await act(async () => {
    for (const run of enter.splice(0))
      run([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}
beforeEach(() => {
  enter = [];
  diagram.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        enter.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? new DOMRect() : new DOMRect(0, 0, 400, 600);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(readTeaching()).toEqual([]);
});
const noop = () => {};
test("Help paints its generated screen before mounting prose, cases or invoking diagrams", async () => {
  render(<RouteHelpButton name="Ducts" docs={ductsDocs} />);
  fireEvent.click(screen.getByRole("button", { name: "How this tool works" }));
  expect(document.querySelector("[data-teach-legend]")).toBeTruthy();
  expect(document.querySelectorAll("article[id^=case-]")).toHaveLength(0);
  expect(screen.queryAllByRole("grid")).toHaveLength(0);
  await reveal();
  expect(document.querySelectorAll("article[id^=case-]")).toHaveLength(0);
  expect(diagram).not.toHaveBeenCalled();
  await reveal();
  await reveal();
  expect(document.querySelectorAll("article[id^=case-]").length).toBeGreaterThan(0);
  expect(diagram).toHaveBeenCalledTimes(2);
  const tables = screen.getAllByRole("grid");
  expect(tables).toHaveLength(DUCTS_COMPARE.length + 2);
  tables.forEach((table) => {
    expect(table.closest("[data-table-scroll]")).toBeTruthy();
    within(table)
      .getAllByRole("gridcell")
      .forEach((cell) => expect(cell.getAttribute("data-column-label")).toBeTruthy());
  });
  act(() => within(tables[0]!).getAllByRole("gridcell")[0]!.focus());
  expect(readTeaching()).toEqual([]);
});
const options = [
  { value: "parallel", label: "parallel", title: "Measured" },
  { value: "perspective", label: "perspective", title: "Depth" },
];
function ListFixture({ mode = "parallel", extra = false }: { mode?: string; extra?: boolean }) {
  const list = useList({
    items: Array.from({ length: 8 }, (_, i) => ({ key: String(i), name: `Duct ${i}` })),
    keyOf: (x) => x.key,
    search: (x) => ({ text: [x.name] }),
    fields: {
      name: { label: "Name", kind: "text", read: (x) => x.name },
      ...(extra ? { size: { label: "Size", kind: "number" as const, read: () => 10 } } : {}),
    },
  });
  return (
    <Pane
      id="systems"
      title="Systems"
      floaters={[
        {
          key: "schematic",
          kind: "picture",
          label: "schematic",
          place: "br",
          open: false,
          onOpenChange: noop,
          render: () => null,
        },
      ]}
    >
      <TeachRegion value={undefined}>
        <Switcher ariaLabel="projection" options={options} value={mode} onChange={noop} />
      </TeachRegion>
      <ListView
        list={list}
        aria-label="systems"
        row={(x) => ({ label: x.name })}
        empty={{ message: "Empty", exit: "Load" }}
      />
    </Pane>
  );
}
function Tutorial() {
  return <HelpWorld facts={useTeaching()} />;
}
test("ListView publishes real fields; the open tutorial follows modes and fields, and unmount withdraws all facts", () => {
  const page = (mode: string, extra: boolean) => (
    <StrictMode>
      <ListFixture mode={mode} extra={extra} />
      <Pane title="Untaught">body</Pane>
      <Tutorial />
    </StrictMode>
  );
  const view = render(page("parallel", false));
  const tutorial = screen
    .getAllByRole("region", { name: "Systems" })
    .find((node) => !node.hasAttribute("data-slot"))!;
  expect(tutorial.querySelector("[data-teach-search]")?.textContent).toContain("Name");
  expect(within(tutorial).getByText("parallel · active")).toBeTruthy();
  expect(within(tutorial).getByLabelText("schematic").textContent).toContain("available");
  expect(screen.getByRole("heading", { name: "2 Untaught" })).toBeTruthy();
  view.rerender(page("perspective", true));
  expect(within(tutorial).getByText("perspective · active")).toBeTruthy();
  expect(tutorial.querySelector("[data-teach-search]")?.textContent).toContain("Size");
});
test("the tutorial preserves three pane rectangles, one leader per pane, and scoped single-item key rows", () => {
  const rects = [
    [20, 50, 200, 600],
    [220, 50, 800, 450],
    [220, 500, 800, 150],
    [0, 0, 0, 600],
  ];
  const facts: Teaching[] = rects.map(([left, top, width, height], i) => ({
    kind: "region",
    id: String(i),
    label: `Pane ${i}`,
    rect: { left, top, width, height },
  }));
  const keys = (scope: string, region?: string): Teaching => ({
    kind: "keys",
    id: scope,
    scope,
    region,
    items: Array.from({ length: 7 }, (_, i) => ({ keys: [String(i)], label: `${scope}-${i}` })),
  });
  facts.push(
    ...["0", "1", "2", "3"].map((id) => keys(id, id)),
    ...["navigation", "Situation", "feedback"].map((scope) => keys(scope)),
  );
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      const n = (key: string) => Number(this.parentElement!.getAttribute(key)) / 2;
      return new DOMRect(200 + n("x"), n("y"), n("width"), n("height"));
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-key")
        ? new DOMRect(0, 0, 100, 100)
        : new DOMRect(0, 0, 900, 400);
    },
  );
  const { container } = render(<HelpWorld facts={facts} />);
  const panes = [...container.querySelectorAll("[data-leader-source]")].map(
    (node) => node.parentElement!,
  );
  expect(panes).toHaveLength(3);
  panes.forEach((pane, i) => {
    const [left, top, width, height] = rects[i];
    expect(Math.abs(Number(pane.getAttribute("x")) / 2 - (left - 20) / 2)).toBeLessThan(1);
    expect(Math.abs(Number(pane.getAttribute("y")) / 2 - (top - 50) / 2)).toBeLessThan(1);
    expect(Number(pane.getAttribute("width")) / 2).toBe(width / 2);
    expect(Number(pane.getAttribute("height")) / 2).toBe(height / 2);
  });
  expect([...container.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual([
    "M200 150 L100 16",
    "M300 112.5 L100 16",
    "M300 262.5 L100 16",
  ]);
  expect(screen.queryByText("3-0")).toBeNull();
  const legend = container.querySelector("[data-teach-legend]")!;
  expect(legend.querySelectorAll("section")).toHaveLength(3);
  expect(legend.querySelectorAll("dl > div")).toHaveLength(21);
  legend
    .querySelectorAll("dl > div")
    .forEach((row) => expect(row.querySelectorAll("dt")).toHaveLength(1));
});
test("zero-box panes withdraw facts without rehoming them; untitled panes use their list name", async () => {
  const view = render(
    <>
      <div>
        <ListFixture />
      </div>
      <Tutorial />
    </>,
  );
  const wrapper = view.container.firstElementChild as HTMLElement;
  wrapper.hidden = true;
  await waitFor(() => expect(readTeaching()).toEqual([]));
  expect(screen.queryByRole("heading")).toBeNull();
  wrapper.hidden = false;
  await waitFor(() => expect(screen.getByText("parallel · active")).toBeTruthy());
  view.rerender(
    <>
      <Pane id="e-sidebar">
        <div data-list-view="" aria-label="System tree" />
      </Pane>
      <Tutorial />
    </>,
  );
  expect(screen.getByRole("heading", { name: "1 System tree" })).toBeTruthy();
});
test("hidden scopes withdraw keys, modes and regions; key refusal changes remain live", () => {
  function Keys({ refused }: { refused: boolean }) {
    useScopeKeys([
      { hotkey: "O", label: "projection", refusal: refused ? "capturing" : null, callback: noop },
    ]);
    return null;
  }
  const page = (hidden: boolean, refused: boolean) => (
    <>
      <KeyScope id="stage" hidden={hidden}>
        <Pane title="Picture">
          <Keys refused={refused} />
          <Switcher ariaLabel="picture" options={options} value="parallel" onChange={noop} />
        </Pane>
      </KeyScope>
      <Tutorial />
    </>
  );
  const view = render(page(false, false));
  expect(screen.getByText("projection")).toBeTruthy();
  view.rerender(page(false, true));
  expect(screen.getByText(/refuses now: capturing/)).toBeTruthy();
  view.rerender(page(true, true));
  expect(readTeaching()).toEqual([]);
});
test("table search teaches only its real fields and operators and removes them on unmount", () => {
  render(
    <QueryBox
      vocabulary={{
        fields: [
          { label: "Length", kind: "number" },
          { label: "Name", kind: "text" },
          { label: "Drawing" },
        ],
        rules: [],
        count: () => 0,
        values: () => [],
      }}
      state={{ query: "", sorts: [] }}
      onStateChange={noop}
      draft=""
      onDraft={noop}
    />,
  );
  const search = readTeaching().find((f) => f.kind === "search");
  expect(search?.kind === "search" && search.fields.map((f) => f.label)).toEqual([
    "Length",
    "Name",
  ]);
  expect(search?.kind === "search" && search.fields[0]?.operators).toContain(">");
});
