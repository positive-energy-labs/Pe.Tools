import { z } from "zod";
import { field, type RouteDeclaration } from "../route-field.ts";

/**
 * The Parameter Links route holds its draft in Work, so its Page is only the layout: the profile
 * rail's fold. No agent access: Pea edits and previews the draft through the route's actions, and
 * the rail is the person's to fold. (No `demo`: the route has no seeds by ruling.)
 */
export const parameterLinksAddress = {
  path: "/parameter-links",
  title: "Parameter Links",
  fields: { rail: field(z.enum(["open", "folded"]).default("open"), { url: "replace" }) },
} satisfies RouteDeclaration;
