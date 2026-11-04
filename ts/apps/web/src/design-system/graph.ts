import { manyField, type RouteGraph, pane } from "@pe/agent-contracts";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
export const designSystemGraph: RouteGraph = {
  key: "design-system",
  address: "design-system",
  name: "Design System",
  seeds: {
    main: {
      title: "main",
      load: () => import("#/shell/fixture-examples").then((m) => m.routeExamples["design-system"]),
    },
  },
  directory: {
    path: "/design-system",
    title: "Design System",
    label: "Design language",
    exposure: "Preview",
    runtimeNeed: "Browser component catalogue",
    icon: "Palette",
    category: "Explore / maintain",
    blurb:
      "The spec and catalogue for the design language \u00e2\u20ac\u201d production components under production tokens, with the gaps they cannot yet express marked in place.",
    aliases: ["Design", "language"],
    listed: true,
    satellites: [
      {
        to: "/design-system/band",
        label: "band",
      },
      {
        to: "/design-system/list",
        label: "list",
      },
      {
        to: "/design-system/arming",
        label: "arming",
      },
      {
        to: "/design-system/popovers",
        label: "popovers",
      },
      {
        to: "/design-system/swatch",
        label: "swatch",
      },
      {
        to: "/design-system/revit",
        label: "revit",
      },
    ],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
  },
  subjectField: { kind: "singleton", field: "catalog", noun: "design language", keyKind: "name", cardinality: "one", roster: "catalog", detail: "catalog", pane: "main", show: (id) => id },
  fields: { selected: { ...manyField("name", {}), role: "selection" }, catalog: { ...field(z.enum(["builtin"]).default("builtin"), {}), role: "subject" } },
  readings: { catalog: { kind: "derive", source: "catalog", retire: "never" } },
  verbs: {},
  panes: {
    main: {
      label: "Design System",
      purpose:
        "The spec and catalogue for the design language \u00e2\u20ac\u201d production components under production tokens, with the gaps they cannot yet express marked in place.",
      draws: ["catalog"],
      verbs: [],
    },
  },
  layout: pane("main"),
  stages: { main: { word: "Design System", panes: ["main"], verbs: [] } },
};
