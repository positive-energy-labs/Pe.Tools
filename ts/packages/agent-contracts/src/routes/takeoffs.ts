import { field, text, type RouteDeclaration } from "../route-field.ts";
import { planViewport } from "./shared.ts";

export const takeoffsAddress = {
  path: "/takeoffs",
  title: "Takeoffs",
  fields: {
    level: field(text(), { url: "push" }),
    zone: field(text(), { url: "push" }),
    room: field(text(), { url: "push" }),
    viewport: planViewport,
  },
  agent: {
    policy:
      "Change only the viewport of the visible Takeoffs plan. Use plane:scale,tx,ty in the displayed frame, or an empty viewport to fit. Facts identify the exact live, saved or fixture capture and current level scope. This does not change level, zone, room, action scope, Work or an RHVAC file, and does not read or write Revit.",
  },
} satisfies RouteDeclaration;
