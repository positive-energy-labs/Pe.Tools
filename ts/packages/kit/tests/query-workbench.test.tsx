// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { QueryVocabulary, TableState } from "@pe/kit/table/model";
import { ColumnMenu, ColumnQuery, QueryWorkbench } from "@pe/kit/table/query-workbench";
import { QueryBox } from "@pe/kit/table/query";

afterEach(cleanup);
const vocabulary: QueryVocabulary = {
  fields: [
    { label: "Flow", kind: "number", sort: "flow" },
    { label: "Room", kind: "text", sort: "room" },
  ],
  rules: [],
  count: () => 3,
  values: () => [
    { value: "4", count: 1 },
    { value: "14", count: 2 },
  ],
};
const initial: TableState = {
  query: "Room~Office Flow>4",
  sorts: [
    { key: "room", dir: "asc" },
    { key: "flow", dir: "desc" },
  ],
};
function Harness({ header = false }: { header?: boolean }) {
  const [state, onStateChange] = useState(initial);
  const control = { vocabulary, state, onStateChange };
  return (
    <>
      {header ? (
        <ColumnQuery.Provider value={control}>
          <ColumnMenu label="Flow" heading="Flow" direction="desc" rank={1} sortCount={2} />
        </ColumnQuery.Provider>
      ) : (
        <QueryWorkbench {...control} />
      )}
      <output data-testid="state">{JSON.stringify(state)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as TableState;

test("named defaults project into chips and picker toggles without a second enabled state", () => {
  const filters: QueryVocabulary["filters"] = [
    {
      clause: "Flow>=4",
      label: "Scheduled flow",
      description: "Only measured flow of at least four",
      default: true,
    },
  ];
  function NamedFilters() {
    const [value, set] = useState<TableState>({ query: "Flow>=4 Room~Office", sorts: [] });
    const [draft, setDraft] = useState("");
    const v = { ...vocabulary, filters };
    return (
      <>
        <QueryBox
          vocabulary={v}
          state={value}
          onStateChange={set}
          draft={draft}
          onDraft={setDraft}
        />
        <QueryWorkbench vocabulary={v} state={value} onStateChange={set} />
        <output data-testid="state">{JSON.stringify(value)}</output>
      </>
    );
  }
  render(<NamedFilters />);
  fireEvent.change(screen.getByLabelText("table query"), { target: { value: "Scheduled" } });
  expect(state().query).toBe("Flow>=4 Room~Office");
  fireEvent.change(screen.getByLabelText("table query"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Scheduled flow default" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: 'Remove the "Scheduled flow default" narrowing' }),
  );
  expect(state().query).toBe("Room~Office");
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore default filters" }));
  expect(state().query).toBe("Room~Office Flow>=4");
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("option", { name: /^Scheduled flow/ }));
  expect(state().query).toBe("Room~Office");
  expect(screen.queryByRole("option")).toBeNull();
});

test("a column clear preserves other columns' conditions and sort order", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(state()).toEqual({ query: "Room~Office", sorts: [{ key: "room", dir: "asc" }] });
});

test("opening a filter for editing leaves the applied query intact until replacement", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: "Flow > 4" }));
  expect(state()).toEqual(initial);
});

test("header picks append their condition to the same canonical query", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("option", { name: /is empty/i }));
  expect(state().query).toBe("Room~Office Flow>4 Flow=");
});

test("NOT flips only the binary operators and a final pick dismisses the column popover", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  expect(screen.queryByRole("option", { name: /is not|≠/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "negate" }));
  expect(screen.getByRole("option", { name: "≠" })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /is not empty/i }));
  expect(state().query).toBe("Room~Office Flow>4 Flow!=");
  expect(screen.queryByRole("option")).toBeNull();
});

test("comparisons stay direct under NOT and the popover stays through the operator stage", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: "negate" }));
  fireEvent.click(screen.getByRole("option", { name: ">" }));
  expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("option", { name: /^14/ }));
  expect(state().query).toBe("Room~Office Flow>4 Flow>14");
});

test("NOT is → value serializes the negative and the toggle stays pressed on the value stage", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: "negate" }));
  fireEvent.click(screen.getByRole("option", { name: "≠" }));
  expect(screen.getByRole("button", { name: "negate" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: /^14/ }));
  expect(state().query).toBe("Room~Office Flow>4 Flow!=14");
});

test("a comparison ignores NOT and hides the toggle on its value stage", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: "negate" }));
  fireEvent.click(screen.getByRole("option", { name: "≥" }));
  expect(screen.queryByRole("button", { name: "negate" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /^14/ }));
  expect(state().query).toBe("Room~Office Flow>4 Flow>=14");
});

test("editing an existing != shows the negated stage", () => {
  const Edit = () => {
    const [s, set] = useState<TableState>({ query: "Flow!=4", sorts: [] });
    return (
      <ColumnQuery.Provider value={{ vocabulary, state: s, onStateChange: set }}>
        <ColumnMenu label="Flow" heading="Flow" direction={false} rank={0} sortCount={0} />
      </ColumnQuery.Provider>
    );
  };
  render(<Edit />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: /^Flow\s.*4/ }));
  expect(screen.getByRole("button", { name: "negate" }).getAttribute("aria-pressed")).toBe("true");
});

const escape = (el: Element) => fireEvent.keyDown(el, { key: "Escape" });
const search = () => screen.getByLabelText(/search$/) as HTMLInputElement;

test("Escape clears the query, then steps back a rung, then closes; a column starts on operators", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  fireEvent.click(screen.getByRole("option", { name: ">" }));
  fireEvent.change(search(), { target: { value: "1" } });
  escape(search());
  expect(search().value).toBe("");
  expect(screen.getByRole("option", { name: /^14/ })).toBeTruthy();
  escape(search());
  expect(screen.getByRole("option", { name: ">" })).toBeTruthy();
  escape(search());
  expect(screen.queryByLabelText(/search$/)).toBeNull();
  expect(state()).toEqual(initial);
});

test("the Filters workbench walks field, operator, value; only the value dismisses it", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("option", { name: /^Flow/ }));
  expect(screen.getByRole("option", { name: "≥" })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "≥" }));
  expect(search()).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /^14/ }));
  expect(state().query).toBe("Room~Office Flow>4 Flow>=14");
  expect(screen.queryByLabelText(/search$/)).toBeNull();
});

test("Escape in the workbench closes it from the first rung", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  escape(search());
  expect(screen.queryByLabelText(/search$/)).toBeNull();
});

test("a column picker draws no heading band; the workbench orients with crumbs", () => {
  const { unmount } = render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Flow: filter and sort" }));
  expect(screen.queryByRole("button", { name: "operator" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: ">" }));
  expect(screen.queryByRole("button", { name: "value" })).toBeNull();
  unmount();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("option", { name: /^Flow/ }));
  expect(screen.getByRole("button", { name: "Flow" })).toBeTruthy();
});
