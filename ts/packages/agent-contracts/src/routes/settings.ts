import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";

import { SETTINGS_SECTIONS } from "../settings-sections.ts";
export { SETTINGS_SECTIONS } from "../settings-sections.ts";

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
