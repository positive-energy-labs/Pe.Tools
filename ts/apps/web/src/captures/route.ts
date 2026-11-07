import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import {
  capturesArgs,
  capturesValue,
} from "../../../../packages/agent-contracts/src/captures-read.ts";
export const loaded = {
  ...hostRead(valueRead("captures.browse", capturesArgs, capturesValue)),
  args: () => ({}),
};
export const fields = {
  focus: field(z.string(), "", "pose"),
  open: field(z.array(z.string()), [], "pose"),
};
export type { Context as CapturesContext } from "./context.generated";
export const module = route({
  key: "captures",
  name: "Captures",
  needs: "host",
  host: "../../../host/src/reads/captures.ts",
  directory: {
    group: "Coordinate model data",
    summary: "Inspect retained view pictures and receipts",
    label: "Revit data",
    exposure: "Preview",
    runtimeNeed: "Host retained view images",
    icon: "Image",
    aliases: ["Revit", "data"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields,
  core: loaded,
  panes: {
    captures: {
      title: "Captures",
      purpose: "Inspect retained pictures",
      draw: draw(() => import("./drawing.tsx"), "CapturesDrawing"),
    },
  },
  layout: paneLayout("captures"),
});
