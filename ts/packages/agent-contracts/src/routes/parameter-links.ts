import { z } from "zod";
import { field, type RouteAddress } from "../route-field.ts";
import { demo } from "./shared.ts";

export const parameterLinksAddress = {
  path: "/parameter-links",
  title: "Parameter Links",
  fields: { view: field(z.enum(["links", "plan"]).default("links"), { url: "push" }), demo },
} satisfies RouteAddress;
