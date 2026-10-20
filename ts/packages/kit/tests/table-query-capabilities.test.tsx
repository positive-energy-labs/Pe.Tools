// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { QueryVocabulary } from "@pe/kit/table/model";
import { QueryBox } from "@pe/kit/table/query";
import { useTableState } from "@pe/kit/table/view";

afterEach(cleanup);

const vocabulary: QueryVocabulary = {
  fields: [
    { label: "Flow", kind: "number", sort: "flow" },
    { label: "Room Name", kind: "text" },
    { label: "Identity", sort: "id" },
    { label: "System", kind: "text" },
  ],
  rules: [],
  count: () => 3,
  values: (field) =>
    field === "System"
      ? [{ value: "RA", label: "Return air", count: 2 }]
      : field === "Flow"
        ? [
            { value: "0", count: 1 },
            { value: "1200", count: 2 },
          ]
        : [{ value: "Open Office", count: 2 }],
};

function Harness() {
  const [state, onStateChange] = useTableState();
  const [draft, onDraft] = useState("");
  return (
    <>
      <QueryBox
        vocabulary={vocabulary}
        state={state}
        onStateChange={onStateChange}
        draft={draft}
        onDraft={onDraft}
        onInput={() => {}}
      />
      <output data-testid="query">{state.query}</output>
      <output data-testid="sorts">{JSON.stringify(state.sorts)}</output>
    </>
  );
}
function type(text: string) {
  const box = screen.getByRole("combobox", { name: "table query" });
  box.focus();
  fireEvent.change(box, { target: { value: text } });
  return box;
}

test("numeric autocomplete offers nonempty without treating zero as empty", () => {
  render(<Harness />);
  type("Flow");
  fireEvent.click(screen.getByRole("option", { name: /is not empty/i }));
  expect(screen.getByTestId("query").textContent).toBe("Flow!=");
});

test("a sort-only field is discoverable and can be sorted through the query picker", () => {
  render(<Harness />);
  const box = type("Identity");
  const sort = screen
    .getAllByRole("option")
    .find((option) => /sort/i.test(option.textContent ?? ""));
  expect(sort).toBeDefined();
  fireEvent.click(sort!);
  expect(screen.getByTestId("sorts").textContent).toContain('"key":"id"');
  expect(box.getAttribute("aria-invalid")).not.toBe("true");
});

test("numeric autocomplete rejects malformed literals and offers scoped numeric values", () => {
  render(<Harness />);
  const box = type("Flow>1200cfm");
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByRole("option", { name: /as typed/i })).toBeNull();
  fireEvent.change(box, { target: { value: "Flow>" } });
  expect(screen.getByRole("option", { name: /1200.*2 rows/i })).toBeDefined();
});

test("value completion quotes a multi-word value and keeps the field intact", () => {
  render(<Harness />);
  type('"Room Name"=');
  fireEvent.click(screen.getByRole("option", { name: /Open Office/i }));
  expect(screen.getByTestId("query").textContent).toBe('"Room Name"="Open Office"');
});

test("picking a quoted field, operator, and value writes one condition without stray search words", () => {
  render(<Harness />);
  type("Room");
  fireEvent.click(screen.getByRole("option", { name: /Room Name.*text filter/i }));
  fireEvent.click(screen.getByRole("option", { name: /^is$/i }));
  fireEvent.click(screen.getByRole("option", { name: /Open Office/i }));
  expect(screen.getByTestId("query").textContent).toBe('"Room Name"="Open Office"');
});

test("categorical autocomplete matches human labels and commits their stored values", () => {
  render(<Harness />);
  type("System=Return");
  fireEvent.click(screen.getByRole("option", { name: /Return air.*2 rows/i }));
  expect(screen.getByTestId("query").textContent).toBe("System=RA");
});
