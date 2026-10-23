import { z } from "zod";
import { field, type RouteDeclaration } from "../route-field.ts";

/**
 * Where the grille calculator is: the active profile row and whether the export sheet is open.
 * The rows themselves are the page's edits, kept in the page (persistence is Owed), not the URL.
 */
export const grillesAddress = {
  path: "/grilles",
  title: "Grilles",
  fields: {
    /** The active profile row: the one the drawing and the field chart show. */
    row: field(z.string().max(64).default("row7"), { url: "push" }),
    /** The printable export sheet is open. */
    sheet: field(z.boolean().default(false), { url: "push" }),
  },
} satisfies RouteDeclaration;
