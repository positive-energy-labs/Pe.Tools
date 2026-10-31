import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import type { z } from "zod";
import { ductLossAddress } from "../../../../packages/agent-contracts/src/routes/duct-loss";

export type DuctLossPage = {
  [K in keyof typeof ductLossAddress.fields]: z.output<
    (typeof ductLossAddress.fields)[K]["schema"]
  >;
};
const fields = ductLossAddress.fields;

export const ductLossGraph: RouteGraph<DuctLossPage, null> = {
  key: "duct-loss",
  address: "duct-loss",
  name: "Duct Loss",
  fields: {
    shape: { ...fields.shape, role: "subject" },
    a: { ...fields.a, role: "query" },
    b: { ...fields.b, role: "query" },
    cfm: { ...fields.cfm, role: "query" },
    length: { ...fields.length, role: "query" },
    roughness: { ...fields.roughness, role: "query" },
    density: { ...fields.density, role: "query" },
    face: { ...fields.face, role: "pose" },
  },
  readings: {
    result: {
      kind: "derive",
      source: "duct-loss.solve",
      args: (page) => page,
      deps: ["page"],
      retire: "page",
    },
  },
  verbs: {},
  panes: {
    wheel: { label: "Wheel", purpose: "Drag diameter or airflow", draws: ["result"], verbs: [] },
    inputs: {
      label: "Inputs",
      purpose: "Type the duct and read its loss",
      draws: ["result"],
      verbs: [],
    },
    charts: {
      label: "Charts",
      purpose: "Four lenses on the same law",
      draws: ["result"],
      verbs: [],
    },
  },
  layout: split(
    "calc",
    { axis: "v", sized: "end", size: 360 },
    split("top", { axis: "h", sized: "end", size: 320 }, pane("wheel"), pane("inputs")),
    pane("charts"),
  ),
  stages: {
    calculate: {
      word: "Calculating",
      panes: ["wheel", "inputs", "charts"],
      verbs: [],
      teach:
        "Calculate duct friction from dimensions and airflow. The wheel, charts and formula use the same inputs. All calculation runs in this browser. The formula is ASHRAE Fundamentals, Duct Design: Darcy friction with the Altshul-Tsal factor (L in ft, D in inches, roughness in ft, density in lb/ft3). The wheel reads the friction-chart power law 0.109136·Q^1.9/D^5.02 for galvanized duct and standard air, as the SMACNA Ductulator does; it runs up to a tenth above the Altshul-Tsal figure.",
    },
  },
  pick: false,
};
