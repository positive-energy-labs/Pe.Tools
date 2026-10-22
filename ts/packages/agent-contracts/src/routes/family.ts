import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";
import { entityFields, tableFields } from "./entity.ts";
import { demo } from "./shared.ts";

export const familyAddress = {
  path: "/family",
  title: "Family",
  fields: {
    ...entityFields,
    ...tableFields(),
    /** The table's values: the staged draft, what Revit carries, or the saved member. */
    overlay: field(z.enum(["draft", "live", "saved"]).default("draft"), {
      url: "push",
      agent: "set",
    }),
    /** The type the table drills into; empty = the family's parameter table. */
    drill: field(text(512), { url: "push", agent: "set" }),
    /** The inspector's subject: `part:<slug>` or `param:<name>`; empty = closed. */
    inspector: field(
      z
        .string()
        .max(1024)
        .regex(/^((part|param):.+)?$/, "an inspector subject is part:<slug> or param:<name>")
        .default(""),
      { url: "replace", agent: "set" },
    ),
    /** The doc pane reads as text or as a sheet. */
    doc: field(z.enum(["text", "sheet"]).default("text"), { url: "replace", agent: "set" }),
    demo,
  },
  agent: {
    policy:
      "Change the visible Family view: stage, the table's query line, sort (`-key` descending) and hidden columns, the overlay (draft, live or saved values), the drilled type (a type name; empty = the family table), the inspector (`part:<slug>` or `param:<name>`; empty = closed) and the doc pane (text or sheet). Facts name the family, its types, parts and parameters. The opened spec (pod, path) is the person's: read it. A view change never reads Revit, stages a value, builds or applies.",
  },
} satisfies RouteDeclaration;
