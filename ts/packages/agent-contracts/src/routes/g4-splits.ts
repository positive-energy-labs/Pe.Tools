import { field, text } from "../route-field.ts";
export const sessionAdminAddress = {
  path: "/session-admin" as const,
  title: "Sessions",
  fields: { session: field(text(), { url: "push" }) },
};
