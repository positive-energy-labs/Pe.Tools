import { field, text, type RouteDeclaration } from "../route-field.ts";
import { demo, entityFields } from "./shared.ts";

export const schedulesAddress = {
  path: "/schedules",
  title: "Schedules",
  fields: {
    ...entityFields,
    /** The open schedule's reading, so a reload reopens it; opening one replaces the place. */
    workspaceId: field(text(), { url: "replace" }),
    demo,
  },
} satisfies RouteDeclaration;
