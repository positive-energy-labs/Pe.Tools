import { field, text, type RouteDeclaration } from "../route-field.ts";
import { entityFields, tableFields } from "./entity.ts";
import { demo } from "./shared.ts";

/** The Families query a page opens with: its filter clauses that default on (web `FAMILIES_FILTERS`). */
export const FAMILIES_DEFAULT_QUERY = "!empty !absent";

export const familiesAddress = {
  path: "/families",
  title: "Families",
  fields: {
    ...entityFields,
    ...tableFields(FAMILIES_DEFAULT_QUERY),
    /** History's picked past read (a saved matrix reading id); empty = the newest. */
    past: field(text(128), { url: "push", agent: "set" }),
    demo,
  },
  agent: {
    policy:
      "Change the visible Families view: stage, the query line, sort (`-key` descending), hidden columns, and in History the past read (an id from facts; empty = newest). Facts give the rule help, the visible reading and its counts, and the past reads. The opened spec (pod, path) is the person's: read it. A view change never reads the matrix, writes Work or touches Revit.",
  },
} satisfies RouteDeclaration;
