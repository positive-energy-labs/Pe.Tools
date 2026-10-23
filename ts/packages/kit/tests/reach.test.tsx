// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useCollection, useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import { sideAwayFrom } from "../src/components/lang/popover";
import { Row } from "../src/components/lang/row";
import { StateCell } from "../src/components/lang/cell";
import { nameOrFallback, subjectDocument } from "../src/components/lang/subject-text";

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
