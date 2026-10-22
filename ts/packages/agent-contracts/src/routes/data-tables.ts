import { type RouteDeclaration } from "../route-field.ts";

/** Carry only (target, work, thread): a typed link with no route keys. */
export const dataTablesAddress = {
  path: "/data-tables",
  title: "Data Tables",
  fields: {},
} satisfies RouteDeclaration;
