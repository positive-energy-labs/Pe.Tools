import { z } from "zod";
import { field, type RouteDeclaration } from "../route-field.ts";

/** Galvanized steel's absolute roughness in feet: the duct-loss default and its material row. */
export const GALVANIZED_STEEL_ROUGHNESS = 0.0003;

export const ductLossAddress = {
  path: "/duct-loss",
  title: "Duct Loss",
  fields: {
    shape: field(z.enum(["round", "rect"]).default("round"), { url: "push", agent: "set" }),
    // Typed inputs: each keystroke tweaks the place, so they replace.
    a: field(z.number().default(12), { url: "replace", agent: "set" }),
    b: field(z.number().default(8), { url: "replace", agent: "set" }),
    cfm: field(z.number().default(1000), { url: "replace", agent: "set" }),
    length: field(z.number().default(100), { url: "replace", agent: "set" }),
    roughness: field(z.number().default(GALVANIZED_STEEL_ROUGHNESS), {
      url: "replace",
      agent: "set",
    }),
    density: field(z.number().default(0.075), { url: "replace", agent: "set" }),
    face: field(z.enum(["commercial", "residential"]).default("commercial"), {
      url: "push",
      agent: "set",
    }),
  },
  agent: {
    policy:
      "Set the duct the person sees: shape, a (diameter, or width when rect), b (height, rect only), cfm, length in ft, roughness in ft, density in lb/ft3, and the wheel face. The calculation is local to the browser and writes nothing to Revit. Facts carry the solved loss, velocity and equivalent diameter for the displayed inputs.",
  },
} satisfies RouteDeclaration;
