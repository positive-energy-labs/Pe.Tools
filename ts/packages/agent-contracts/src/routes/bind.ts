import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";

/**
 * No agent access, deliberately: binding a Page to a thread or a document is the person's door
 * (the host writes the binding on their press), so Pea has nothing here to read or set.
 */
export const bindAddress = {
  path: "/bind",
  title: "Bind",
  fields: {
    page: field(text(), { url: "push" }),
    view: field(z.boolean().default(false), { url: "push" }),
    query: field(text(), { url: "push" }),
    fragment: field(text(), { url: "push" }),
  },
} satisfies RouteDeclaration;
