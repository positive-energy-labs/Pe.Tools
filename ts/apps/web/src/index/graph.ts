import { manyField, type RouteGraph, pane } from "@pe/agent-contracts";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
export const indexGraph: RouteGraph = {
key: "index", address: "home", name: "Tools",
seeds: { main: { title: "Tool directory", load: async () => ({ readings: { catalog: { id: "builtin", label: "Tool directory" } } }) } },
directory: {
  "path": "/",
  "title": "Tools",
  "label": "Tools",
  "exposure": "Main",
  "runtimeNeed": "Host navigation",
  "icon": "LayoutGrid",
  "category": "Explore / maintain",
  "blurb": "Tools and saved work",
  "aliases": [
    "home",
    "tools",
    "directory"
  ],
  "listed": false,
  "satellites": [],
  "surfaces": {
    "web": "full",
    "pwa": "full",
    "tray": false
  }
},
  subjectField: { kind: "singleton", field: "catalog", noun: "tool directory", keyKind: "name", cardinality: "one", roster: "catalog", detail: "catalog", pane: "main", show: (id) => id },
fields: { selected: { ...manyField("name", {}), role: "selection" }, catalog: { ...field(z.enum(["builtin"]).default("builtin"), {}), role: "subject" } }, readings: { catalog: { kind: "derive", source: "catalog", retire: "never" } }, verbs: {}, panes: { main: {label: "Tools", purpose: "Tools and saved work", draws: ["catalog"], verbs: []}}, layout: pane("main"), stages: { main: {word: "Tools", panes: ["main"], verbs: []}}
};
