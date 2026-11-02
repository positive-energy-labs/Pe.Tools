import { field, text, type RouteDeclaration } from "../route-field.ts";
export const podAdminAddress = { path: "/pod-admin", title: "Pod administration", fields: { pod: field(text(), { url: "push", agent: "read" }) } } satisfies RouteDeclaration;
