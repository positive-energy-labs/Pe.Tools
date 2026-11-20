import * as contracts from "./contract.ts";
import type { ContextOf } from "@pe/web-kernel/route";
import { read } from "@pe/web-kernel/route";
import { paneLayout } from "@pe/web-kernel/route";
import { z } from "zod";
import { field, route } from "@pe/web-kernel/route";
import { hostRead } from "@pe/web-kernel/host-read";
import { draw } from "@pe/web-kernel/route/draw";

export const loaded = read(hostRead(contracts.browse));
export const fields = {
  focus: field(z.string(), "", "pose"),
  open: field(z.array(z.string()), [], "pose"),
};
export type CapturesContext = ContextOf<typeof fields, typeof loaded, never, never>;
export const module = route({
  key: "captures",
  name: "Captures",
  needs: "host",
  host: "./host.ts",
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
      body: "scroll",
      draw: draw("scroll", () => import("./drawing.tsx"), "CapturesDrawing"),
    },
  },
  layout: paneLayout("captures"),
});
