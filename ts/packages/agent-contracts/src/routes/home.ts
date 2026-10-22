import { z } from "zod";
import { field, text, type RouteAddress } from "../route-field.ts";

/** The home directory: its filters. */
export const homeAddress = {
  path: "/",
  title: "Home",
  fields: {
    query: field(text(), { url: "replace" }),
    exposure: field(z.enum(["All", "Main", "Preview", "Archive"]).default("All"), {
      url: "push",
    }),
    sort: field(z.enum(["workflow", "name"]).default("workflow"), { url: "push" }),
  },
} satisfies RouteAddress;
