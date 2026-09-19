// @vitest-environment jsdom
/**
 * The schema table renderer is the one `Table`: a grid whose cells are the table's editable cell
 * (commit on Enter or blur, the unsaved mark on a changed cell), whose dynamic headings rename
 * their key, and whose row verbs still edit the JSON array.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { RenderSchemaNode } from "@pe/schema-core";

import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
// The renderer is lazy; loaded here so the first render does not wait on its cold transform.
import "./table-field";

afterEach(cleanup);

const schema = {
  type: "object",
  properties: {
    sizes: {
      type: "array",
      "x-ui": { renderer: "table", behavior: { fixedColumns: ["Name"], missingValue: "" } },
      items: { type: "object", properties: { Name: { type: "string" } } },
    },
  },
} as unknown as RenderSchemaNode;

const initial = { sizes: [{ Name: "A", Small: "1" }] };

function Host({ onValues }: { onValues: (v: typeof initial) => void }) {
  const [values, setValues] = useState(initial);
  return (
    <SchemaToFieldRender
      schema={schema}
      schemaUrl=""
      baselineValues={initial}
      values={values}
      onChange={(path, value) => {
        const next = structuredClone(values) as Record<string, unknown>;
        const keys = path.split(".");
        let node = next;
        for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
        node[keys.at(-1)!] = value;
        setValues(next as typeof initial);
        onValues(next as typeof initial);
      }}
    />
  );
}

test("a schema table is the one grid: cells commit, headings rename, rows add and drop", async () => {
  let last = initial;
  render(<Host onValues={(v) => (last = v)} />);
  const grid = await screen.findByRole("grid");

  // A cell is the table's editable cell: typing stays in the cell until Enter or blur commits.
  const cells = within(grid).getAllByRole("gridcell");
  const small = within(cells[1]!).getByRole("textbox");
  fireEvent.change(small, { target: { value: "2" } });
  fireEvent.blur(small);
  expect(last.sizes).toEqual([{ Name: "A", Small: "2" }]);
  await waitFor(() =>
    expect(within(grid).getAllByRole("gridcell")[1]!.querySelector("[data-unsaved]")).not.toBe(
      null,
    ),
  );

  // A dynamic heading renames its key in every row.
  const heading = within(grid).getByDisplayValue("Small");
  fireEvent.change(heading, { target: { value: "Large" } });
  fireEvent.blur(heading);
  expect(last.sizes).toEqual([{ Name: "A", Large: "2" }]);

  fireEvent.click(screen.getByRole("button", { name: /add row/ }));
  expect(last.sizes).toHaveLength(2);
  const rows = within(await screen.findByRole("grid")).getAllByRole("row");
  fireEvent.click(within(rows.at(-1)!).getByRole("button", { name: /remove/ }));
  expect(last.sizes).toEqual([{ Name: "A", Large: "2" }]);
});

test("a primary column with options is the in-cell list, and typed text is still a value", async () => {
  let last = initial;
  const withOptions = structuredClone(schema) as unknown as {
    properties: { sizes: { items: { properties: { Name: { enum?: string[] } } } } };
  };
  withOptions.properties.sizes.items.properties.Name.enum = ["A", "B"];
  function Options() {
    const [values, setValues] = useState(initial);
    return (
      <SchemaToFieldRender
        schema={withOptions as unknown as RenderSchemaNode}
        schemaUrl=""
        baselineValues={initial}
        values={values}
        onChange={(_path, value) => {
          const next = { sizes: value as typeof initial.sizes };
          setValues(next);
          last = next;
        }}
      />
    );
  }
  render(<Options />);
  const grid = await screen.findByRole("grid");
  fireEvent.click(within(grid).getByRole("button", { name: /A/ }));
  fireEvent.click(await screen.findByRole("option", { name: "B" }));
  expect(last.sizes[0]!.Name).toBe("B");
});
