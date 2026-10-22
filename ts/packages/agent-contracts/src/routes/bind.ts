import { z } from "zod";
import { field, text, type RouteAddress } from "../route-field.ts";

export const bindAddress = {
  path: "/bind",
  title: "Bind",
  fields: {
    page: field(text(), { url: "push" }),
    view: field(z.boolean().default(false), { url: "push" }),
  },
} satisfies RouteAddress;
