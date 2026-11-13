import { sessionCommand } from "../route/typed-actions.ts";
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
    },
  },
  commands: {
    stop: {
      ...sessionCommand("instances.stop"),
      label: "Stop Revit",
      input: (_context, supplied) => supplied,
    },
    restart: {
      ...sessionCommand("instances.restart"),
      label: "Hot reload Revit",
      input: (_context, supplied) => supplied,
    },
    start: {
      ...sessionCommand("instances.start"),
      label: "Start Revit and open",
      input: (_context, supplied) => supplied,
    },
    open: {
      ...sessionCommand("instances.open"),
      label: "Open document",
      input: (_context, supplied) => supplied,
    },
    close: {
      ...sessionCommand("instances.close"),
      label: "Close document",
      input: (_context, supplied) => supplied,
    },
  },
  layout: paneLayout("documents"),
});
