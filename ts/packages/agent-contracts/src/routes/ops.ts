import { field, text, type RouteAddress } from "../route-field.ts";

export const opsAddress = {
  path: "/ops",
  title: "Ops",
  fields: { op: field(text(), { url: "replace" }), actionId: field(text(), { url: "replace" }) },
} satisfies RouteAddress;
