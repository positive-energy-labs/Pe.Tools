import { field, text, type RouteAddress } from "../route-field.ts";
import { demo } from "./shared.ts";

export const podsAddress = {
  path: "/pods",
  title: "Pods",
  fields: { pod: field(text(), { url: "push" }), path: field(text(1024), { url: "push" }), demo },
} satisfies RouteAddress;
