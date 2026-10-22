import { z } from "zod";
import { field, type RouteDeclaration } from "../route-field.ts";
import { demo, entityFields } from "./shared.ts";

/** The Families query a page opens with: its filter clauses that default on (web `FAMILIES_FILTERS`). */
export const FAMILIES_DEFAULT_QUERY = "!empty !absent";

export const familiesAddress = {
  path: "/families",
  title: "Families",
  fields: {
    ...entityFields,
    query: field(z.string().max(4096).default(FAMILIES_DEFAULT_QUERY), {
      url: "push",
      agent: "set",
    }),
    demo,
  },
  agent: {
    policy:
      "Change the query line of one mounted Families view. The browser acknowledges the rendered query and counts. No Work or Revit read.",
  },
} satisfies RouteDeclaration;
