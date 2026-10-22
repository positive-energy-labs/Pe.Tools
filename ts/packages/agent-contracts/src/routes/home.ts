import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";

/** The home directory: its filters, and which tools' saved Works are folded. */
export const homeAddress = {
  path: "/",
  title: "Home",
  fields: {
    query: field(text(), { url: "replace", agent: "set" }),
    exposure: field(z.enum(["All", "Main", "Preview", "Archive"]).default("All"), {
      url: "push",
      agent: "set",
    }),
    sort: field(z.enum(["workflow", "name"]).default("workflow"), {
      url: "push",
      agent: "set",
    }),
    /** Tool paths whose saved Works are folded away. */
    folded: field(z.array(z.string().max(120)).default([]), { url: "replace", agent: "set" }),
  },
  agent: {
    policy:
      "Filter and order the tool directory the person sees: query text, exposure, sort, and which tools fold their saved Works. Facts list the tools that match. Opening a tool or a Work stays the person's.",
  },
} satisfies RouteDeclaration;
