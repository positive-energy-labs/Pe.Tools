// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { useCallback } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useCollection, useList } from "../src/components/lang/collection";
import { ListView, listColumns } from "../src/components/lang/list-view";
import { sideAwayFrom } from "../src/components/lang/popover";
import { Row } from "../src/components/lang/row";
import { StateCell } from "../src/components/lang/cell";
import { SubjectTextContext } from "../src/components/lang/reach";
import { nameOrFallback, subjectDocument, SubjectText } from "../src/components/lang/subject-text";
import { HOVER_GRACE, useHoverGrace } from "../src/components/lang/hover-grace";

import { Button } from "../src/components/lang/button";
import { FactChip } from "../src/components/lang/chip";
import { Switcher } from "../src/components/lang/switcher";
import { PaneCrumb } from "../src/components/lang/pane-crumb";
import { SvgTip, TooltipProvider } from "../src/components/lang/tooltip";
import { reachStore, useReach } from "../src/components/lang/reach";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

test("pressing a reference uses focus reach and its popup shares the lighting grace", async () => {
  vi.useFakeTimers();
  const reach = reachStore();
  const go = vi.fn();
  function Fixture() {
    const close = useCallback(
      () => reach.set((s) => ({ ...s, lighting: { ids: new Set(), references: [], focus: null } })),
      [],
    );
    const grace = useHoverGrace<string>(close);
    return (
      <SubjectTextContext
        value={{
          nameOf: () => "FR-2",
          reach,
          go,
          light: (references, focus, owner) => {
            grace.cancel();
            reach.set((s) => ({
              ...s,
              lighting: { ids: new Set([42]), references, focus, owner },
            }));
          },
          clear: grace.leave,
        }}
      >
        <SubjectText text={["Open end at ", { id: 42 }]} />
        <button>outside</button>
      </SubjectTextContext>
    );
  }
  const view = render(
    <TooltipProvider delay={0}>
      <Fixture />
    </TooltipProvider>,
  );
  const reference = screen.getByRole("button", { name: "go to FR-2, reference 1" });
  fireEvent.mouseEnter(reference);
  fireEvent.pointerEnter(reference);
  fireEvent.click(reference);
  expect(reference.getAttribute("data-reach")).toBe("focus");
  expect(reference.className).toBe("subject-ref");
  for (const attribute of ["aria-pressed", "data-pressed", "data-lit"])
    expect(reference.hasAttribute(attribute)).toBe(false);
  expect(go).toHaveBeenCalledWith(42);
  fireEvent.mouseLeave(reference);
  fireEvent.mouseLeave(view.container.querySelector("[data-subject-text]")!);
  await act(() => vi.advanceTimersByTime(950));
  expect(reach.get().lighting.focus).toBe(42);
  fireEvent.mouseEnter(reference);
  fireEvent.mouseMove(reference);
  await act(() => vi.advanceTimersByTime(400));
  const popup = screen.getByRole("tooltip");
  fireEvent.mouseOut(reference, { relatedTarget: popup });
  fireEvent.mouseLeave(reference);
  fireEvent.mouseOut(view.container.querySelector("[data-subject-text]")!, {
    relatedTarget: popup,
  });
  fireEvent.mouseLeave(view.container.querySelector("[data-subject-text]")!);
  fireEvent.mouseOver(popup);
  fireEvent.mouseEnter(popup);
  await act(async () => screen.getByRole("button", { name: "outside" }).focus());
  await act(() => vi.advanceTimersByTime(950));
  expect(popup.isConnected).toBe(true);
  expect(reach.get().lighting.focus).toBe(42);
  fireEvent.mouseOut(popup, { relatedTarget: screen.getByRole("button", { name: "outside" }) });
  fireEvent.mouseOver(screen.getByRole("button", { name: "outside" }));
  fireEvent.mouseLeave(popup);
  fireEvent.mouseLeave(popup.parentElement!);
  await act(() => vi.advanceTimersByTime(HOVER_GRACE - 1));
  expect(reach.get().lighting.focus).toBe(42);
  await act(() => vi.advanceTimersByTime(2));
  expect(reach.get().lighting.focus).toBeNull();
});

test("focus and landing are outline-only, and reference contact never fills or boxes the word", () => {
  const css = readFileSync(createRequire(import.meta.url).resolve("@pe/kit/lang/lang.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const focus = rules.filter(
    ([, selector]) =>
      selector!.includes('[data-reach="focus"]') && selector!.includes("[data-reach]:"),
  );
  expect(focus).toHaveLength(1);
  expect(focus[0]![2]).toContain("outline: 2px solid");
  const landed = rules.filter(([, selector]) => selector!.trim() === "[data-landed]");
  for (const [, , body] of [...focus, ...landed])
    expect(body).not.toMatch(/background(?:-\w+)?\s*:/);
  expect(css.match(/@keyframes pe-land\s*\{([\s\S]*?)\n\}/)![1]).not.toContain("background");
  const mark = rules.filter(
    ([, selector]) => selector!.includes(".subject-ref") && selector!.includes(".subject-mark"),
  );
  for (const [, , body] of mark) expect(body).not.toMatch(/background(?:-\w+)?\s*:/);
  render(
    <>
      <style>{[...focus, ...landed].map(([rule]) => rule).join("\n")}</style>
      <div data-reach="focus" data-landed="" data-testid="focus-box" />
    </>,
  );
  expect(getComputedStyle(screen.getByTestId("focus-box")).backgroundColor).toBe(
    "rgba(0, 0, 0, 0)",
  );
});

const rect = (left: number, top: number, width = 10, height = 10) =>
  ({ left, top, width, height }) as DOMRect;

test("a popover avoiding a subject opens on the anchor side away from it", () => {
  expect(sideAwayFrom(rect(100, 0), rect(100, 200))).toBe("top");
  expect(sideAwayFrom(rect(100, 300), rect(100, 200))).toBe("bottom");
  expect(sideAwayFrom(rect(0, 100), rect(200, 100))).toBe("left");
  expect(sideAwayFrom(rect(400, 100), rect(200, 100))).toBe("right");
});

test("list columns declare shared cell kinds and yield priorities without width classes", () => {
  expect(
    listColumns({ total: { kind: "number", priority: 0 }, loss: { kind: "number", priority: 2 } }),
  ).toEqual({
    total: { "data-list-column": "number", "data-priority": 0 },
    loss: { "data-list-column": "number", "data-priority": 2 },
  });
});

test.each(["pointerEnter", "focus"] as const)(
  "a clipped row exposes its full title on %s without replacing the row",
  (reach) => {
    const { container } = render(<Row label="A long run name" tabIndex={0} depth={9} />);
    const row = container.querySelector<HTMLElement>(".dl-row")!;
    Object.defineProperty(row.querySelector(".dl-row-title"), "scrollWidth", { value: 300 });
    fireEvent[reach](row);
    expect(row.getAttribute("aria-description")).toBe("A long run name");
    expect(container.querySelector(".dl-row")).toBe(row);
    expect(row.getAttribute("aria-level")).toBe("10");
  },
);

test("a damaged row says its damage in words beside the title", () => {
  render(<Row label="EX 4" damage="no price" />);
  expect(document.querySelector("[data-damage='no price'] .dl-row-damage")?.textContent).toBe(
    "no price",
  );
});

test("damage stays on the value at either cell scale", () => {
  render(
    <>
      <StateCell value="" scale="row" damage="no airflow" />
      <StateCell value="" damage="no price" />
    </>,
  );
  expect(document.querySelectorAll(".dl-cell[data-damage]")).toHaveLength(2);
});

test("an unknown structured subject retains its identity with the kit fallback and footnote", () => {
  expect(nameOrFallback("  ")).toBe(nameOrFallback());
  expect(subjectDocument([{ id: 1234567 }], () => null).references).toEqual([
    { id: 1234567, name: nameOrFallback(), number: 1 },
  ]);
});

test("a list shows no cursor until the pointer or a key puts one there (I4)", () => {
  function Fixture() {
    const list = useList({
      items: ["a", "b", "c"],
      keyOf: (item) => item,
      search: (item) => ({ text: [item] }),
    });
    return (
      <ListView
        list={list}
        aria-label="letters"
        row={(item) => ({ label: item })}
        empty={{ message: "Empty", exit: "Add" }}
      />
    );
  }
  render(<Fixture />);
  expect(document.querySelector("[data-cursor]")).toBeNull();
});

test("the pointer moving the cursor never scrolls; a key moving it does (N1)", () => {
  const scrolled = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrolled;
  function Fixture() {
    const collection = useCollection({
      items: ["a", "b", "c"],
      keyOf: (item) => item,
      labelOf: (item) => item,
      target: null,
    });
    return (
      <div role="listbox" tabIndex={0} data-testid="list">
        {["a", "b", "c"].map((key) => {
          const props = collection.rowProps(key);
          return (
            <div key={key} id={props.id} onMouseMove={props.onMouseMove}>
              {key}
            </div>
          );
        })}
        <button onClick={() => collection.setCursor("c", true)}>key</button>
      </div>
    );
  }
  render(<Fixture />);
  fireEvent.mouseMove(screen.getByText("b"));
  expect(scrolled).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("key"));
  expect(scrolled).toHaveBeenCalledTimes(1);
});

const noop = () => {};
function Mirror() {
  return <output data-testid="mirror">{useReach(42)}</output>;
}

test("rows and picture subscribers share reach without updating the route", () => {
  const reach = reachStore();
  const route = vi.fn();
  function Route() {
    route();
    return (
      <SubjectTextContext value={{ nameOf: () => "duct", reach }}>
        <Row label="duct" revit={[42]} />
        <Mirror />
      </SubjectTextContext>
    );
  }
  render(<Route />);
  const row = screen.getByText("duct").closest(".dl-row")!;
  expect(row.getAttribute("data-reach")).toBe("rest");
  act(() =>
    reach.set((state) => ({ ...state, lighting: { ...state.lighting, ids: new Set([42]) } })),
  );
  expect(row.getAttribute("data-reach")).toBe("reach");
  fireEvent.mouseEnter(row);
  expect(screen.getByTestId("mirror").textContent).toBe("hover");
  act(() => reach.set((state) => ({ ...state, lighting: { ...state.lighting, focus: 42 } })));
  expect(row.getAttribute("data-reach")).toBe("focus");
  expect(route).toHaveBeenCalledTimes(1);
});

test("every target declares reach; the cell unit and padding focus its input", () => {
  const view = render(
    <>
      <Button label="frame">Frame</Button>
      <StateCell scale="row" value="420" unit={{ label: "cfm" }} onCommit={noop} />
      <FactChip title="flow">fact</FactChip>
      <Switcher
        options={[{ value: "a", label: "A", title: "A" }]}
        value="a"
        onChange={noop}
        ariaLabel="mode"
      />
      <PaneCrumb segments={[{ label: "scope", onPress: noop }]} />
      <svg>
        <g data-testid="mark">
          <path d="M0 0L1 1" />
          <SvgTip content="duct" />
        </g>
      </svg>
    </>,
  );
  for (const target of view.container.querySelectorAll("button, .dl-cell, [data-svg-tip]"))
    expect(target.hasAttribute("data-reach")).toBe(true);
  expect(screen.getByText("fact").closest("[data-reach]")).toBeTruthy();
  const cell = view.container.querySelector<HTMLElement>(".dl-cell")!;
  const input = cell.querySelector("input")!;
  fireEvent.mouseDown(view.container.querySelector(".dl-cell-unit")!);
  expect(document.activeElement).toBe(input);
  input.blur();
  fireEvent.mouseDown(cell);
  expect(document.activeElement).toBe(input);
  const button = screen.getByRole("button", { name: "frame" });
  fireEvent.pointerOver(button);
  expect(button.getAttribute("data-reach")).toBe("hover");
  fireEvent.focus(button);
  expect(button.getAttribute("data-reach")).toBe("focus");
});
