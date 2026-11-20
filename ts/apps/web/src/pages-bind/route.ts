import * as contracts from "./contract.ts";
import type { ContextOf, Verbs } from "@pe/web-kernel/route";
import { handle } from "@pe/agent-contracts/handle";
import { read } from "@pe/web-kernel/route";
import { paneLayout } from "@pe/web-kernel/route";
import { z } from "zod";
import { route, field, subjectSchema, oneName, nameOf } from "@pe/web-kernel/route";
import { hostRead } from "@pe/web-kernel/host-read";
import { draw } from "@pe/web-kernel/route/draw";

/** The Page is the subject (keyKind `name`, tuple `[slug]`); `view` shows it in place of the binding choice. */
export const fields = {
  page: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push"),
  view: field(z.boolean(), false, "pose"),
};
/** The Page's own URL query and fragment, carried through to its viewer. */
export const query = {
  query: field(z.record(z.string(), z.string()), {}, "query"),
  fragment: field(z.string(), "", "query"),
};
export const loaded = read(hostRead(contracts.picker));
export type BindContext = ContextOf<
  typeof fields & typeof query,
  typeof loaded,
  never,
  never,
  Verbs<"bind">
>;
export const module = route({
  key: "bind",
  name: "Bind",
  // Binding a Page is the person's press; Pea has no Page lease here.
  agent: false,
  needs: "host",
  host: "./host.ts",
  directory: {
    label: "Document",
    exposure: "Main",
    group: "Start / open work",
    icon: "Link2",
    runtimeNeed: "Host document bindings",
    summary: "Bind a Page to a document or thread",
    aliases: ["document", "binding"],
    listed: false,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields,
  query,
  subject: {
    field: "page",
    noun: "Page",
    multiple: false,
    pane: "main",
    read: loaded,
    options: (data) =>
      (data?.pages ?? []).map((p) => ({ id: oneName(p.slug).ids[0]!, label: p.title || p.slug })),
  },
  core: loaded,
  panes: {
    main: {
      title: "Bind Page",
      purpose: "Choose a Page binding",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "BindBody"),
      // The pane holds the binding the person chose.
      verbs: ["bind"],
    },
  },
  verbs: {
    bind: {
      handle: handle("page.bind"),
      label: "Bind",
      input: ({ page }, binding) => ({ slug: nameOf(page.page), binding }),
    },
  },
  layout: paneLayout("main"),
});
