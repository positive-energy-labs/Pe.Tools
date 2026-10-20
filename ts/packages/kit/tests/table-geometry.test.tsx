// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Table } from "../src/components/master-table/table";
import { ReadCell } from "../src/components/master-table/cells";

afterEach(cleanup);

const VERTICAL_PAD = /^(p|py|pt|pb)-(?!0$)/;
const classes = (element: Element) => [...element.classList];

test("the header row and a body row are both exactly --item-h, ruled inside, never padded", () => {
  render(
    <Table
      rows={[{ id: "one" }]}
      rowKey={(row) => row.id}
      label="Geometry table"
      columns={[
        {
          key: "id",
          label: "ID",
          sort: (row) => row.id,
          cell: (row) => <ReadCell value={row.id} />,
        },
        { key: "plain", label: "Plain", cell: (row) => row.id },
      ]}
    />,
  );
  const heads = screen.getAllByRole("columnheader");
  const row = screen.getAllByRole("row").find((tr) => tr.closest("tbody"))!;
  const cell = screen.getAllByRole("gridcell")[0]!;
  expect(classes(row)).toContain("h-(--item-h)");
  for (const head of heads) {
    expect(classes(head)).toContain("h-(--item-h)");
    expect(classes(head)).not.toContain("border-b");
  }
  for (const element of [row, cell, cell.firstElementChild!, ...heads])
    expect(classes(element).filter((name) => VERTICAL_PAD.test(name))).toEqual([]);
});
