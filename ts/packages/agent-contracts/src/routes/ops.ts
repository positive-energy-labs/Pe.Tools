import { field, text, type RouteDeclaration } from "../route-field.ts";

/**
 * No agent access, deliberately: Ops is the raw operation console, an admin door. Pea runs an
 * operation through `pe_do`, and a second path to the same call would be a duplicate choice in
 * normal discovery (`route:ops.*` stays out of the capability catalog).
 */
export const opsAddress = {
  path: "/ops",
  title: "Ops",
  fields: {
    /** The operation whose request form is open. Picking one is a step; Back returns to the last. */
    op: field(text(), { url: "push" }),
    /** The journaled receipt shown; a run sets it, so it is a tweak of the same place. */
    actionId: field(text(), { url: "replace" }),
  },
} satisfies RouteDeclaration;
