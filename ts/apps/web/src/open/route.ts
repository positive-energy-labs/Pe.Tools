import { sessionCommand } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { route, field } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { EMPTY_DRAFT } from "./model";
import { openData } from "@pe/agent-contracts";
export const fields = {
  draft: field(
    z.object({
      doc: z.string().nullable(),
      target: z.string().nullable(),
      year: z.number().int().nullable(),
      owner: z.enum(["you", "pea"]),
      addins: z.enum(["on", "off"]),
      detach: z.boolean(),
      links: z.enum(["refuse", "allow"]),
    }),
    { ...EMPTY_DRAFT },
    "pose",
  ),
  table: field(
    z.object({
      query: z.string(),
      sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
      hiddenColumns: z.array(z.string()).optional(),
    }),
    { query: "", sorts: [] },
    "query",
  ),
};
export const loaded = read(hostRead(valueRead("open.documents", z.object({}), openData)));
export type { Context as OpenContext } from "./context.generated";
export const module = route({
  key: "open",
  name: "Open document",
  needs: "host",
  host: "../../../host/src/reads/open.ts",
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
