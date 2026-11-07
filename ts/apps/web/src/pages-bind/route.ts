import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import { route, field, rpcAction, queryAction } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { bindData } from "@pe/agent-contracts";
import { readPageTarget } from "./client";
export const fields = {
  page: field(z.string(), "", "query", "push"),
  view: field(z.boolean(), false, "pose"),
  query: field(z.record(z.string(), z.string()), {}, "query"),
  fragment: field(z.string(), "", "pose"),
};
export const loaded = { ...hostRead(valueRead("bind.picker", z.object({}), bindData)), args: () => ({}) };
export type { Context as BindContext } from "./context.generated";
export const module = route({
  key: "bind",
  name: "Bind",
  needs: "host",
  host: "../../../host/src/reads/bind.ts",
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
  core: loaded,
  panes: {
    main: {
      title: "Bind Page",
      purpose: "Choose a Page binding",
      draw: draw(() => import("./mount"), "BindBody"),
    },
  },
  commands: {
    bind: {
      ...rpcAction(pageBindRpc),
      label: "Bind",
      input: ({ page }, binding) => ({ slug: page.page, binding }),
    },
    read: {
      ...queryAction({
        key: "bind.target",
        input: z.object({ slug: z.string().min(1) }),
        run: ({ slug }) => readPageTarget(slug),
      }),
      label: "Read binding",
      input: ({ page }) => ({ slug: page.page }),
    },
  },
  layout: paneLayout("main"),
});
