import { field, text, type RouteDeclaration } from "../route-field.ts";

export const opsAddress = {
  path: "/ops",
  title: "Ops",
  fields: { op: field(text(), { url: "replace" }), actionId: field(text(), { url: "replace" }) },
} satisfies RouteDeclaration;
