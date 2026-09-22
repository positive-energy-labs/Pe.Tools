// @vitest-environment jsdom
/**
 * A family model's record sections (`types`, `datums`, …: `additionalProperties`, no `properties`)
 * render as keyed rows that open the value's own schema, and host issues land on their field.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { RenderSchemaNode } from "@pe/schema-core";

import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import type { MemberIssue } from "@pe/host-contracts/operation-types";

afterEach(cleanup);

const schema = {
  type: "object",
  properties: {
    types: {
      type: "object",
      additionalProperties: { type: "object", additionalProperties: { type: "string" } },
    },
    datums: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: { plane: { type: "string" } },
      },
    },
  },
} as RenderSchemaNode;

function Host({ issues, onValues }: { issues?: MemberIssue[]; onValues?: (v: object) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({
    types: { Type1: { Height: "10" } },
    datums: { "Ref. Level": { plane: "Z" } },
  });
  return (
    <SchemaToFieldRender
      schema={schema}
      schemaUrl=""
      baselineValues={values}
      values={values}
      issues={issues}
      onChange={(path, value) => {
        const next = structuredClone(values);
        const keys = path.split(".");
        let node = next as Record<string, unknown>;
        for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
        node[keys.at(-1)!] = value;
        setValues(next);
        onValues?.(next);
      }}
    />
  );
}

test("a record section renders its keys as rows and edits a nested scalar", async () => {
  let last: object = {};
  render(<Host onValues={(v) => (last = v)} />);
  const height = (await waitFor(
    () => {
      const input = document.getElementById("types.Type1.Height");
      if (!input) throw Error("no Height field");
      return input;
    },
    { timeout: 5000 },
  )) as HTMLInputElement;
  // The row is the type's own record, legend and all.
  expect(within(height.closest("fieldset")!).getByText("Type1")).toBeTruthy();
  expect(height.value).toBe("10");
  fireEvent.change(height, { target: { value: "12" } });
  expect(last).toMatchObject({ types: { Type1: { Height: "12" } } });

  // A real datum name with a dot is stated, not mis-addressed: no field reads `datums.Ref`.
  expect(screen.getByText(/edit it in raw mode/)).toBeTruthy();
  expect(document.getElementById("datums.Ref. Level.plane")).toBeNull();

  // Add a key from the value schema's defaults; remove it again.
  const newKey = screen.getByRole("textbox", { name: "new datums key" });
  const datums = within(newKey.closest("fieldset")!);
  fireEvent.change(newKey, { target: { value: "Ref Level" } });
  fireEvent.click(datums.getByRole("button", { name: "add key" }));
  expect(last).toMatchObject({ datums: { "Ref Level": {}, "Ref. Level": { plane: "Z" } } });
  const added = (await datums.findByText("Ref Level")).closest("fieldset")!.parentElement!
    .parentElement!;
  fireEvent.click(within(added).getByRole("button", { name: "remove key" }));
  expect(last).toEqual(expect.objectContaining({ datums: { "Ref. Level": { plane: "Z" } } }));

  // A key the dot path cannot carry is refused, with the reason on the verb.
  fireEvent.change(newKey, { target: { value: "a.b" } });
  const add = datums.getByRole("button", { name: "add key" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  expect(add.title).toMatch(/dot/);
});

test("a host diagnostic at $.datums lands on the datums field", async () => {
  render(
    <Host
      issues={[
        { code: "schema.type", message: "must be object", path: "$.datums", severity: "error" },
      ]}
    />,
  );
  const datums = (await screen.findByText("datums", {}, { timeout: 5000 })).closest("fieldset")!;
  expect(within(datums).getByText("must be object")).toBeTruthy();
  const types = screen.getByText("types").closest("fieldset")!;
  expect(within(types).queryByText("must be object")).toBeNull();
});
