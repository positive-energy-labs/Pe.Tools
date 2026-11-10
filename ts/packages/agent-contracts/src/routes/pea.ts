import { z } from "zod";
import { manyField, field, text, type RouteDeclaration } from "../route-field.ts";
import { threadListFields } from "./shared.ts";

export const peaAddress = {
  path: "/pea",
  title: "Pea",
  fields: {
    ...threadListFields,
    selected: manyField("name", { url: "replace", agent: "set" }),
    /** The turn to focal-scroll on open; absent = the tail. */
    turn: field(z.number().int().positive().optional(), { url: "replace" }),
    /** The composer draft: in the address bar, never in a link. */
    prompt: field(text(), { url: "replace", share: false }),
  },
} satisfies RouteDeclaration;
