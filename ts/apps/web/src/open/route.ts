import { handle } from "@pe/agent-contracts/handle";
import { paneLayout } from "../route/defaults";
import { route } from "../route/defaults";
import { draw } from "../route/draw";
import { fields, loaded } from "../machine/open-fields";
export const module = route({
  key: "open",
  name: "Open document",
  needs: "host",
  host: "./host.ts",
  directory: {
    label: "Open document",
    exposure: "Main",
    group: "Start / open work",
    icon: "Server",
    runtimeNeed: "Host document discovery and Revit lifecycle",
    summary: "Choose a document and its destination Revit",
    aliases: ["documents", "model", "launcher"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: "compact" },
  },
  fields,
  core: loaded,
  panes: {
    documents: {
      title: "Documents",
      purpose: "Choose a model and destination Revit",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "OpenBody"),
      // Each verb takes the document and session the person chose in this pane.
      verbs: ["stop", "restart", "start", "open", "close"],
    },
  },
  verbs: {
    stop: {
      handle: handle("instances.stop"),
      label: "Stop Revit",
    },
    restart: {
      handle: handle("instances.restart"),
      label: "Hot reload Revit",
    },
    start: {
      handle: handle("instances.start"),
      label: "Start Revit and open",
    },
    open: {
      handle: handle("instances.open"),
      label: "Open document",
    },
    close: {
      handle: handle("instances.close"),
      label: "Close document",
    },
  },
  layout: paneLayout("documents"),
});
