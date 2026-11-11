import type { ContextOf } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { route, field } from "../route/defaults";
import { draw } from "../route/draw";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
export const fields = {
  threadSearch: field(
    threadListFields.threadSearch.schema,
    threadListFields.threadSearch.schema.parse(undefined),
    "query",
  ),
  threadSort: field(
    threadListFields.threadSort.schema,
    threadListFields.threadSort.schema.parse(undefined),
    "query",
  ),
  query: field(z.string(), "", "query"),
  exposure: field(z.enum(["All", "Main", "Preview", "Archive"]), "All", "query", "push"),
  sort: field(z.enum(["workflow", "name"]), "workflow", "query", "push"),
  folded: field(z.array(z.string()), [], "query"),
};
export type HomeContext = ContextOf<typeof fields, never, never, never>;
export const module = route({
  key: "home",
  name: "Home",
  address: "/",
  needs: "browser",
  directory: {
    label: "Home",
    exposure: "Main",
    group: "Start / open work",
    icon: "House",
    runtimeNeed: "Host activity and tool directory",
    summary: "Find tools and resume open work",
    aliases: [],
    listed: false,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields,
  panes: {
    main: {
      title: "Home",
      purpose: "Find tools and inspect activity",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "HomeBody"),
    },
  },
  layout: paneLayout("main"),
});
