import { z } from "zod";
import { manyField, field, type RouteDeclaration } from "../route-field.ts";

export const capturesAddress = {
  path: "/captures",
  title: "Captures",
  fields: {
    /** The picture the list scrolls to and marks; absent = none. */
    sha: field(z.string().max(64).optional(), { url: "push", agent: "set" }),
    /** The shas whose receipt is unfolded. */
    open: manyField("name", { url: "replace", agent: "set" }),
  },
  agent: {
    policy:
      "Focus one kept picture by sha, and unfold or fold receipts. Facts list the kept captures (sha, view, time). This does not take a capture or read Revit.",
  },
} satisfies RouteDeclaration;
