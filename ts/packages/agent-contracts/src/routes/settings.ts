import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";

/** The Settings sections a link may open, in page order. */
export const SETTINGS_SECTIONS = [
  "revit",
  "update",
  "share",
  "pea",
  "host",
  "notices",
  "appearance",
] as const;

export const settingsAddress = {
  path: "/settings",
  title: "Settings",
  fields: {
    section: field(z.enum(SETTINGS_SECTIONS).optional(), { url: "push" }),
    session: field(text(), { url: "push" }),
  },
} satisfies RouteDeclaration;
