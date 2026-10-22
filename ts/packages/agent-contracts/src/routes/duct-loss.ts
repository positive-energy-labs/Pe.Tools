import { z } from "zod";
import { field, type RouteDeclaration } from "../route-field.ts";

/** Galvanized steel's absolute roughness in feet: the duct-loss default and its material row. */
export const GALVANIZED_STEEL_ROUGHNESS = 0.0003;

export const ductLossAddress = {
  path: "/duct-loss",
  title: "Duct Loss",
  fields: {
    shape: field(z.enum(["round", "rect"]).default("round"), { url: "push" }),
    // Typed inputs: each keystroke tweaks the place, so they replace.
    a: field(z.number().default(12), { url: "replace" }),
    b: field(z.number().default(8), { url: "replace" }),
    cfm: field(z.number().default(1000), { url: "replace" }),
    length: field(z.number().default(100), { url: "replace" }),
    roughness: field(z.number().default(GALVANIZED_STEEL_ROUGHNESS), { url: "replace" }),
    density: field(z.number().default(0.075), { url: "replace" }),
    face: field(z.enum(["commercial", "residential"]).default("commercial"), { url: "push" }),
  },
} satisfies RouteDeclaration;
