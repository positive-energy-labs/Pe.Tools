import type { ContextOf } from "@pe/web-kernel/route";
import { paneLayout } from "@pe/web-kernel/route";
import { z } from "zod";
import { field } from "@pe/agent-contracts/route";
import { route } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
/** Home has no subject and no slot data: every Page field is route-owned `query` (ADR 0035 rule 1). */
export const query = {
  ...threadListFields,
  query: field(z.string(), "", "query"),
  exposure: field(z.enum(["All", "Main", "Preview", "Archive"]), "All", "query", "push"),
  sort: field(z.enum(["workflow", "name"]), "workflow", "query", "push"),
  folded: field(z.array(z.string()), [], "query"),
};
export type HomeContext = ContextOf<typeof query, never, never, never>;
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
  // 10a's declaration keeps `fields` required; home has none, every field is `query`.
  fields: {},
  query,
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
