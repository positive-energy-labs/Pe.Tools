// @vitest-environment jsdom
/**
 * A CellListSelect inside Table must not steal the table's keys: Enter opens it from the
 * focused td, Escape closes the popover first and then leaves focus on the td, Tab moves to the
 * next cell, and a proposal cell's a / d / u still fire from its own td.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { StateCell, type CellTransition } from "#/components/lang/cell";
import { CellListSelect } from "#/components/lang/list-popup";
import { Table } from "#/components/master-table/table";

afterEach(cleanup);

const OPTIONS = [
  { value: "Text", label: "Text" },
  { value: "Length", label: "Length" },
  { value: "Integer", label: "Integer" },
];

function mount() {
  const accept: CellTransition = { kind: "accept", run: vi.fn(async () => null) };
  const onChange = vi.fn();
  const view = render(
    <Table
      rows={[{ key: "r" }]}
      columns={[
        {
          key: "kind",
          label: "kind",
          cell: () => (
            <CellListSelect
              aria-label="kind"
              region="cells"
              value="Text"
              items={OPTIONS}
              keyOf={(o) => o.value}
              labelOf={(o) => o.label}
              empty="no kinds"
              onPick={(o) => onChange(o.value)}
              row={(o) => ({ label: o.label })}
            />
          ),
        },
        {
          key: "value",
          label: "value",
          cell: () => <StateCell value="10in" scale="row" transitions={[accept]} />,
        },
      ]}
      rowKey={(row) => row.key}
      label="cells"
    />,
  );
  const [selectTd, valueTd] = [
    ...view.container.querySelectorAll<HTMLElement>('td[role="gridcell"]'),
  ];
  return { selectTd: selectTd!, valueTd: valueTd!, accept, onChange };
}

const listbox = () => document.querySelector('[role="listbox"]');

test("Enter opens the select from its td; Escape closes the popover and returns to the td", async () => {
  const { selectTd } = mount();
  await act(async () => selectTd.focus());
  await act(async () => fireEvent.keyDown(selectTd, { key: "Enter" }));
  await vi.waitFor(() => expect(listbox()).not.toBeNull());
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
  await vi.waitFor(() => expect(listbox()).toBeNull());
  expect(document.activeElement).toBe(selectTd);
});

test("picking an option commits it and leaves focus on the td", async () => {
  const { selectTd, onChange } = mount();
  await act(async () => selectTd.focus());
  await act(async () => fireEvent.keyDown(selectTd, { key: "Enter" }));
  await vi.waitFor(() => expect(listbox()).not.toBeNull());
  await act(async () => fireEvent.click(screen.getByRole("option", { name: "Length" })));
  expect(onChange).toHaveBeenCalledWith("Length");
  await vi.waitFor(() => expect(listbox()).toBeNull());
  expect(document.activeElement).toBe(selectTd);
});

test("Tab from the select's td moves to the next cell, where a still accepts", async () => {
  const { selectTd, valueTd, accept } = mount();
  await act(async () => selectTd.focus());
  await act(async () => fireEvent.keyDown(selectTd, { key: "Tab" }));
  expect(document.activeElement).toBe(valueTd);
  await act(async () => fireEvent.keyDown(valueTd, { key: "a", code: "KeyA" }));
  expect(accept.run).toHaveBeenCalledOnce();
});

test("a / d / u never fire from inside an open select", async () => {
  const { selectTd, accept } = mount();
  await act(async () => selectTd.focus());
  await act(async () => fireEvent.keyDown(selectTd, { key: "Enter" }));
  await vi.waitFor(() => expect(listbox()).not.toBeNull());
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: "a", code: "KeyA" }));
  expect(accept.run).not.toHaveBeenCalled();
});
