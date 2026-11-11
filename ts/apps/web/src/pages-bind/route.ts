import type { ContextOf } from "../route/defaults";
import { rpcAction, queryAction } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import { route, field, subjectSchema, oneName, nameOf } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { bindData } from "@pe/agent-contracts";
import { readPageTarget } from "./client";
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
export const loaded = read(hostRead(valueRead("bind.picker", z.object({}), bindData)));
export type BindContext = ContextOf<typeof fields & typeof query, typeof loaded, never, never>;
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
    options: (data) => (data?.pages ?? []).map((p) => ({ id: oneName(p.slug).ids[0]!, label: p.title || p.slug })),
  },
  core: loaded,
  panes: {
    main: {
      title: "Bind Page",
      purpose: "Choose a Page binding",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "BindBody"),
    },
  },
  commands: {
    bind: {
      ...rpcAction(pageBindRpc),
      label: "Bind",
      input: ({ page }, binding) => ({ slug: nameOf(page.page), binding }),
    },
    read: {
      ...queryAction({
        key: "bind.target",
        input: z.object({ slug: z.string().min(1) }),
        run: ({ slug }) => readPageTarget(slug),
      }),
      label: "Read binding",
      input: ({ page }) => ({ slug: nameOf(page.page) }),
    },
  },
  layout: paneLayout("main"),
});
