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
