// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Pane } from "@pe/kit/lang/pane";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Switcher } from "@pe/kit/lang/switcher";
import { readTeaching, type Teaching } from "@pe/kit/lang/teach";
import { TeachPage, TeachRegion, TeachTarget, useTeaching } from "@pe/kit/lang/use-teach";
import { KeyScope, useScopeKeys } from "@pe/kit/keys";
import { QueryBox } from "@pe/kit/table/query";
import { HelpOwner, HelpWorld, RouteHelpButton } from "#/route/help";
import { ductsDocs } from "#/ducts/docs";
import { DUCTS_COMPARE } from "@pe/agent-contracts/ducts-guide";
import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
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
function reveal() {
  act(() => {
    for (const run of enter.splice(0))
      run([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
}
beforeEach(() => {
  enter = [];
  diagram.mockClear();
  vi.stubGlobal("IntersectionObserver", function (callback: IntersectionObserverCallback) {
    return { observe: () => enter.push(callback), disconnect: noop };
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? new DOMRect() : new DOMRect(0, 0, 400, 600);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(readTeaching()).toEqual([]);
});
const noop = () => {};
test("quantity leaders still connect their track to composed rows in either direction", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("dl-leader-track")) return new DOMRect(100, 20, 200, 50);
      if (this.hasAttribute("data-key")) return new DOMRect(400, 100, 100, 40);
      return new DOMRect(0, 0, 600, 300);
    },
  );
  const items = [{ key: "part", at: [0.25], label: "Friction" }];
  const view = render(<LeaderDiagram label="Losses" items={items} />);
  expect(view.container.querySelector("[data-leader-line=part]")?.getAttribute("d")).toBe(
    "M150 70 V120 H300",
  );
  view.rerender(<LeaderDiagram label="Losses" items={items} bottom right />);
  expect(view.container.querySelector("[data-leader-line=part]")?.getAttribute("d")).toBe(
    "M150 20 V120 H100",
  );
});
test("Help paints its generated screen before mounting prose, cases or invoking diagrams", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  render(
    <>
      <HelpOwner />
      <RouteHelpButton name="Ducts" docs={ductsDocs} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "How this tool works" }));
  expect(document.querySelector("[data-teach-legend]")).toBeTruthy();
  expect(document.querySelectorAll("article[id^=case-]")).toHaveLength(0);
  expect(screen.queryAllByRole("grid")).toHaveLength(0);
  reveal();
  expect(document.querySelectorAll("article[id^=case-]")).toHaveLength(0);
  expect(diagram).not.toHaveBeenCalled();
  reveal();
  reveal();
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
  // Only the owner's own chord is live; the dialog's TeachLive=false keeps its contents out.
  expect(
    readTeaching().flatMap((f) => (f.kind === "keys" ? f.items.map((i) => i.label) : [f.kind])),
  ).toEqual(["How this tool works"]);
});
test("Alt+/ teaches the URL's page even from Pea's composer; Pea's own trigger teaches Pea", async () => {
  window.history.pushState({}, "", "/ducts");
  render(
    <>
      <HelpOwner />
      <TeachTarget value="/ducts">
        <RouteHelpButton name="Ducts" />
        <TeachPage value="/pea">
          <RouteHelpButton name="Pea" />
          <Pane title="Composer">
            <textarea aria-label="draft" />
          </Pane>
        </TeachPage>
      </TeachTarget>
    </>,
  );
  // Only the URL page's trigger claims the chord.
  const triggers = screen.getAllByRole("button", { name: "How this tool works" });
  expect(triggers.map((t) => t.hasAttribute("aria-keyshortcuts"))).toEqual([true, false]);
  act(() => screen.getByLabelText("draft").focus());
  fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash", altKey: true });
  await waitFor(() => expect(screen.getByText("Ducts", { selector: ".t-title" })).toBeTruthy());
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("Ducts", { selector: ".t-title" })).toBeNull());
  fireEvent.click(triggers[1]!);
  await waitFor(() => expect(screen.getByText("Pea", { selector: ".t-title" })).toBeTruthy());
  window.history.pushState({}, "", "/");
});
test("Alt+/ toggles; a page's later trigger unmounting restores the earlier one", async () => {
  window.history.pushState({}, "", "/ducts");
  const view = render(
    <>
      <HelpOwner />
      <TeachTarget value="/ducts">
        <RouteHelpButton name="Ducts" />
        <RouteHelpButton name="Ducts later" />
      </TeachTarget>
    </>,
  );
  const chord = () =>
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "/",
      code: "Slash",
      altKey: true,
    });
  chord();
  await waitFor(() =>
    expect(screen.getByText("Ducts later", { selector: ".t-title" })).toBeTruthy(),
  );
  chord();
  await waitFor(() =>
    expect(screen.queryByText("Ducts later", { selector: ".t-title" })).toBeNull(),
  );
  view.rerender(
    <>
      <HelpOwner />
      <TeachTarget value="/ducts">
        <RouteHelpButton name="Ducts" />
      </TeachTarget>
    </>,
  );
  chord();
  await waitFor(() => expect(screen.getByText("Ducts", { selector: ".t-title" })).toBeTruthy());
  window.history.pushState({}, "", "/");
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

test("ListView publishes real fields; the open tutorial follows modes and fields, and unmount withdraws all facts", async () => {
  const page = (mode: string, extra: boolean) => (
    <StrictMode>
      <ListFixture mode={mode} extra={extra} />
      <Pane title="Untaught">body</Pane>
      <Tutorial />
    </StrictMode>
  );
  const view = render(page("parallel", false));
  await screen.findByRole("button", { name: "Read Untaught controls" });
  const tutorial = screen.getByRole("region", { name: "Systems controls" });
  expect(tutorial.querySelector("[data-teach-search]")?.textContent).toContain("Name");
  expect(within(tutorial).getByText("parallel · active")).toBeTruthy();
  expect(within(tutorial).getByLabelText("schematic").textContent).toContain("available");
  expect(screen.getByRole("button", { name: "Read Untaught controls" })).toBeTruthy();
  view.rerender(page("perspective", true));
  expect(within(tutorial).getByText("perspective · active")).toBeTruthy();
  expect(tutorial.querySelector("[data-teach-search]")?.textContent).toContain("Size");
});
test("the foldout preserves pane proportions, selects regions through map and index, and keeps global keys", () => {
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
  const { container } = render(<HelpWorld facts={facts} />);
  const panes = [...container.querySelectorAll<HTMLElement>("[data-map-region]")];
  expect(panes).toHaveLength(3);
  expect(
    panes.map((pane) => [pane.style.left, pane.style.top, pane.style.width, pane.style.height]),
  ).toEqual([
    ["0%", "0%", "20%", "100%"],
    ["20%", "0%", "80%", "75%"],
    ["20%", "75%", "80%", "25%"],
  ]);
  expect(panes.every((pane) => pane.tagName === "BUTTON")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Show Pane 1 controls" }));
  expect(container.querySelector("[data-teach-detail]")?.getAttribute("data-teach-detail")).toBe(
    "1",
  );
  expect(screen.getByText("1-0")).toBeTruthy();
  expect(screen.queryByText("0-0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Read Pane 2 controls" }));
  expect(screen.getByText("2-0")).toBeTruthy();
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
  expect(await screen.findByRole("button", { name: "Read System tree controls" })).toBeTruthy();
});

test("hidden scopes withdraw keys, modes and regions; key refusal changes remain live", async () => {
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
  expect(await screen.findByText("projection")).toBeTruthy();
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
