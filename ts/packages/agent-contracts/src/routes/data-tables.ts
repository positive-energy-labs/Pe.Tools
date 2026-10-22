import { field, text, type RouteDeclaration } from "../route-field.ts";

/**
 * The open table's name in the document the sentence names (the document rides the `target`
 * carry). A new, unnamed draft has no name to link: it is Work in progress, not a Place.
 */
export const dataTablesAddress = {
  path: "/data-tables",
  title: "Data Tables",
  fields: { table: field(text(), { url: "push", agent: "set" }) },
  agent: {
    policy:
      "Open an existing data table of the document the sentence names, by name; an empty table closes the editor. Facts list the table names the document holds. Editing, apply and a new table stay the person's.",
  },
} satisfies RouteDeclaration;
