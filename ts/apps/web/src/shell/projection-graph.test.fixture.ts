// Test-only declarative graph for the retained admitted-kernel contract.
import { manyField, pane, split, type RouteGraph } from "@pe/agent-contracts";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import type {RouteDeclaration} from "../../../../packages/agent-contracts/src/route-field.ts";

/** Galvanized steel's absolute roughness in feet: the duct-loss default and its material row. */
import {GALVANIZED_STEEL_ROUGHNESS} from "@pe/agent-contracts";

export const ductLossAddress = {
  path: "/duct-loss",
  title: "Duct Loss",
  fields: {
    shape: field(z.enum(["round", "rect"]).default("round"), { url: "push", agent: "set" }),
    // Typed inputs: each keystroke tweaks the place, so they replace.
    a: field(z.number().default(12), { url: "replace", agent: "set" }),
    b: field(z.number().default(8), { url: "replace", agent: "set" }),
    cfm: field(z.number().default(1000), { url: "replace", agent: "set" }),
    length: field(z.number().default(100), { url: "replace", agent: "set" }),
    roughness: field(z.number().default(GALVANIZED_STEEL_ROUGHNESS), {
      url: "replace",
      agent: "set",
    }),
    density: field(z.number().default(0.075), { url: "replace", agent: "set" }),
    face: field(z.enum(["commercial", "residential"]).default("commercial"), {
      url: "push",
      agent: "set",
    }),
  },
  agent: {
    policy:
      "Set the duct the person sees: shape, a (diameter, or width when rect), b (height, rect only), cfm, length in ft, roughness in ft, density in lb/ft3, and the wheel face. The calculation is local to the browser and writes nothing to Revit. Facts carry the solved loss, velocity and equivalent diameter for the displayed inputs.",
  },
} satisfies RouteDeclaration;


export type DuctLossPage = { case: "duct" } & {
  [K in keyof typeof ductLossAddress.fields]: z.output<
    (typeof ductLossAddress.fields)[K]["schema"]
  >;
};
const fields = ductLossAddress.fields;

export const ductLossGraph: RouteGraph<DuctLossPage, null> = {
  seeds: {
    calculate: {
      title: "calculate",
      load: () => import("#/shell/fixture-examples").then((m) => m.routeExamples["duct-loss"]),
    },
  },
  directory: {
    path: "/duct-loss",
    title: "Duct Loss",
    label: "Duct friction",
    exposure: "Main",
    runtimeNeed: "Browser calculation",
    icon: "Wind",
    category: "Calculate loads & airflow",
    blurb:
      "The imperial duct friction loss formula, live — type a duct and airflow, read Δp with every intermediate term beside the equation.",
    aliases: ["friction", "airflow", "pressure", "calculator"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
  },
  key: "duct-loss",
  address: "duct-loss",
  name: "Duct Loss",
  subjectField: { kind: "singleton", field: "case", noun: "hypothetical duct case", keyKind: "name", cardinality: "one", roster: "case", detail: "result", pane: "inputs", show: (id) => id },
  fields: { selected: { ...manyField("name", {}), role: "selection" },
    case: { ...field(z.enum(["duct"]).default("duct"), {}), role: "subject" },
    shape: { ...fields.shape, role: "query" },
    a: { ...fields.a, role: "query" },
    b: { ...fields.b, role: "query" },
    cfm: { ...fields.cfm, role: "query" },
    length: { ...fields.length, role: "query" },
    roughness: { ...fields.roughness, role: "query" },
    density: { ...fields.density, role: "query" },
    face: { ...fields.face, role: "pose" },
  },
  readings: {
    case: { kind: "derive", source: "duct-loss.case", retire: "page" },
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
};
