// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useCollection, useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import { sideAwayFrom } from "../src/components/lang/popover";
import { Row } from "../src/components/lang/row";
import { StateCell } from "../src/components/lang/cell";
import {
  SubjectTextContext,
  nameOrFallback,
  subjectDocument,
} from "../src/components/lang/subject-text";

import { Button } from "../src/components/lang/button";
import { FactChip } from "../src/components/lang/chip";
import { Switcher } from "../src/components/lang/switcher";
import { PaneCrumb } from "../src/components/lang/pane-crumb";
import { SvgTip } from "../src/components/lang/tooltip";
import { reachStore, useReach } from "../src/components/lang/reach";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const rect = (left: number, top: number, width = 10, height = 10) =>
  ({ left, top, width, height }) as DOMRect;

test("a popover avoiding a subject opens on the anchor side away from it", () => {
  expect(sideAwayFrom(rect(100, 0), rect(100, 200))).toBe("top");
  expect(sideAwayFrom(rect(100, 300), rect(100, 200))).toBe("bottom");
  expect(sideAwayFrom(rect(0, 100), rect(200, 100))).toBe("left");
  expect(sideAwayFrom(rect(400, 100), rect(200, 100))).toBe("right");
});

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
        <Row label="duct" revitIds={[42]} />
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
