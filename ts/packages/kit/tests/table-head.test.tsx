// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { QueryVocabulary } from "@pe/kit/table/model";
import { ColumnMenu, ColumnQuery } from "@pe/kit/table/query-workbench";

afterEach(cleanup);

const vocabulary: QueryVocabulary = {
  fields: [{ label: "Flow", kind: "number", sort: "flow" }],
  rules: [],
  count: () => 0,
  values: () => [],
};

test("a column head trigger is a plain label at rest: no control frame, the head's alignment", () => {
  render(
    <ColumnQuery.Provider
      value={{ vocabulary, state: { query: "", sorts: [] }, onStateChange: () => {} }}
    >
      <ColumnMenu label="Flow" heading="Flow" direction="asc" rank={0} sortCount={1} right />
    </ColumnQuery.Provider>,
  );
  const trigger = screen.getByRole("button", { name: "Flow: filter and sort" });
  expect(trigger.hasAttribute("data-colhead-trigger")).toBe(true);
  expect(trigger.classList.contains("dl-control")).toBe(false);
  expect(trigger.classList.contains("justify-end")).toBe(true);
  expect(screen.getByLabelText("sorted ascending")).toBeTruthy();
});
