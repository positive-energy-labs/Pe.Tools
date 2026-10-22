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
    /** The open group; absent = what waits on the person opens, `none` = every group folded. */
    section: field(z.enum([...SETTINGS_SECTIONS, "none"]).optional(), {
      url: "push",
      agent: "set",
    }),
    /** The Revit session the revit group shows. */
    session: field(text(), { url: "push", agent: "read" }),
  },
  agent: {
    policy:
      "Open one Settings group, or fold them all with none. Facts name the groups and the state each header shows. Repair, install and configuration actions stay the person's.",
  },
} satisfies RouteDeclaration;
