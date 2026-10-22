import { z } from "zod";
import { modeKey } from "../page-keys.ts";
import { field, text, type RouteAddress } from "../route-field.ts";

export const peaAddress = {
  path: "/pea",
  title: "Pea",
  fields: {
    mode: field(modeKey(["threads", "world"], "threads"), { url: "replace" }),
    /** The turn to focal-scroll on open; absent = the tail. */
    turn: field(z.number().int().positive().optional(), { url: "replace" }),
    /** The composer draft: in the address bar, never in a link. */
    prompt: field(text(), { url: "replace", share: false }),
  },
} satisfies RouteAddress;
