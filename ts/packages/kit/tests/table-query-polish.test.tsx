// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { QueryVocabulary, TableState } from "@pe/kit/table/model";
import { QueryBox } from "@pe/kit/table/query";
import { ColumnMenu, ColumnQuery, QueryWorkbench } from "@pe/kit/table/query-workbench";

afterEach(cleanup);

const vocabulary: QueryVocabulary = {
  fields: [
    { label: "Flow", kind: "number", sort: "flow" },
    { label: "Shared", kind: "text", sort: "shared", enumerated: true },
  ],
  rules: [],
  filters: [
    {
      clause: "Flow>=4",
      label: "Scheduled flow",
      description:
        "Only terminals with a measured flow of at least four, which is what the schedule prints.",
      default: true,
    },
  ],
  count: () => 6,
  values: (field) =>
    field === "Shared"
      ? [
          { value: "yes", count: 4 },
          { value: "no", count: 2 },
        ]
      : [{ value: "4", count: 1 }],
};

test("caret suggestion hints are short facts; the description is the list detail", () => {
  function Box() {
    const [state, onStateChange] = useState<TableState>({ query: "", sorts: [] });
    const [draft, onDraft] = useState("");
    return (
      <QueryBox
        vocabulary={vocabulary}
        state={state}
        onStateChange={onStateChange}
        draft={draft}
        onDraft={onDraft}
        onInput={() => {}}
      />
    );
  }
  render(<Box />);
  const box = screen.getByRole("combobox", { name: "table query" });
  box.focus();
  fireEvent.change(box, { target: { value: "s" } });
  const metas = [...document.querySelectorAll(".dl-row-meta")].map((each) => each.textContent!);
  expect(metas.length).toBeGreaterThan(0);
  for (const meta of metas) expect(meta.length).toBeLessThanOrEqual(40);
  expect(metas).toContain("default · 6 rows");
});

function Harness({ header = false }: { header?: boolean }) {
  const [state, onStateChange] = useState<TableState>({ query: "", sorts: [] });
  const control = { vocabulary, state, onStateChange };
  return (
    <>
      {header ? (
        <ColumnQuery.Provider value={control}>
          <ColumnMenu label="Shared" heading="Shared" direction={false} rank={0} sortCount={0} />
        </ColumnQuery.Provider>
      ) : (
        <QueryWorkbench {...control} />
      )}
      <output data-testid="state">{JSON.stringify(state)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as TableState;
const labels = () => screen.getAllByRole("option").map((each) => each.textContent ?? "");

test("an option column opens on its values, then empty tests, then sorts", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Shared: filter and sort" }));
  expect(screen.queryByRole("option", { name: /contains/ })).toBeNull();
  const all = labels();
  const at = (re: RegExp) => all.findIndex((each) => re.test(each));
  expect(at(/^yes/)).toBeLessThan(at(/is empty/));
  expect(at(/is empty/)).toBeLessThan(at(/sort ↑/));
  fireEvent.click(screen.getByRole("option", { name: /^yes/ }));
  expect(state().query).toBe("Shared=yes");
});

test("not on an option column negates the value as !=", () => {
  render(<Harness header />);
  fireEvent.click(screen.getByRole("button", { name: "Shared: filter and sort" }));
  fireEvent.click(screen.getByRole("button", { name: "negate" }));
  expect(screen.getByRole("option", { name: /is not empty/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /^no/ }));
  expect(state().query).toBe("Shared!=no");
});

test("the workbench goes Shared › value and an empty test stays reachable", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("option", { name: /^Shared/ }));
  expect(screen.getByRole("button", { name: "Shared" })).toBeTruthy();
  // The implied `is` draws no crumb: the band is exactly Shared › value.
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Filters",
    "Shared",
    "value",
    "not",
  ]);
  expect(screen.queryByRole("option", { name: /contains/ })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /is empty/ }));
  expect(state().query).toBe("Shared=");
});
