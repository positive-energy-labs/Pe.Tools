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
export type { Context as HomeContext } from "./context.generated";
export const module = route({
  key: "home",
  name: "Home",
  address: "/",
  needs: "browser",
  directory: {
    label: "Home",
    exposure: "Main",
    group: "Start / open work",
    icon: "Home",
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
      draw: draw(() => import("./mount"), "HomeBody"),
    },
  },
  layout: paneLayout("main"),
});
