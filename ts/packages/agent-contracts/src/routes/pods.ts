import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";
import { demo } from "./shared.ts";

export const podsAddress = {
  path: "/pods",
  title: "Pods",
  fields: {
    /**
     * The open member. Its spec editor holds the person's unsaved typing, and a move to another
     * member starts a fresh editor, so Pea reads the member and never moves it.
     */
    pod: field(text(), { url: "push", agent: "read" }),
    path: field(text(1024), { url: "push", agent: "read" }),
    /** The runs pane lists the open member's runs, or the whole pod's (a draft's run has no member). */
    runs: field(z.enum(["member", "pod"]).default("member"), { url: "replace", agent: "set" }),
    demo,
  },
  agent: {
    policy:
      "Change the visible Pods view: which runs the runs pane lists (the open member's, or the whole pod's). Facts list the installed pods and their members, the open member's schema and its runs. The open member (pod, path) is the person's: read it. A view change never writes a member or runs anything.",
  },
} satisfies RouteDeclaration;
