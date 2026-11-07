import { z } from "zod";
import { valueRead, GALVANIZED_STEEL_ROUGHNESS } from "@pe/agent-contracts";
import { route, field } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { ductLossArgs, ductLossData } from "@pe/agent-contracts";
export const fields = {
  shape: field(ductLossArgs.shape.shape, "round", "query", "push"),
  a: field(z.number(), 12, "query"),
  b: field(z.number(), 8, "query"),
  cfm: field(z.number(), 1000, "query"),
  length: field(z.number(), 100, "query"),
  roughness: field(z.number(), GALVANIZED_STEEL_ROUGHNESS, "query"),
  density: field(z.number(), 0.075, "query"),
  face: field(z.enum(["commercial", "residential"]), "commercial", "pose", "push"),
};
export const loaded = {
  ...hostRead(valueRead("duct-loss.result", ductLossArgs, ductLossData)),
  args: (page: { [K in keyof typeof fields]: z.output<(typeof fields)[K]["schema"]> }) =>
    ductLossArgs.parse(page),
};
export type { Context as DuctLossContext } from "./context.generated";
export const module = route({
  key: "duct-loss",
  name: "Duct Loss",
  needs: "host",
  host: "../../../host/src/reads/duct-loss.ts",
  directory: {
    label: "Duct friction",
    exposure: "Main",
    group: "Calculate loads & airflow",
    icon: "Wind",
    runtimeNeed: "Host calculation",
    summary: "Calculate duct friction with intermediate terms beside the equation",
    aliases: ["friction", "airflow", "pressure", "calculator"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  core: loaded,
  fields,
  panes: {
    wheel: {
      title: "Wheel",
      purpose: "Drag diameter or airflow",
      draw: draw(() => import("./route.tsx"), "WheelBody"),
    },
    inputs: {
      title: "Inputs",
      purpose: "Type a duct and read its loss",
      draw: draw(() => import("./route.tsx"), "InputsBody"),
    },
    charts: {
      title: "Charts",
      purpose: "Inspect the friction law",
      draw: draw(() => import("./route.tsx"), "ChartsBody"),
    },
  },
  layout: {
    kind: "split",
    axis: "v",
    id: "calc",
    size: 360,
    sized: "end",
    children: [
      {
        kind: "split",
        axis: "h",
        id: "top",
        size: 320,
        sized: "end",
        children: [
          { kind: "pane", id: "wheel" },
          { kind: "pane", id: "inputs" },
        ],
      },
      { kind: "pane", id: "charts" },
    ],
  },
});
