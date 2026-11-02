import { type RouteGraph, pane } from "@pe/agent-contracts";
export const indexGraph: RouteGraph = {
key: "index", address: "home", name: "Tools",
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
fields: {}, readings: {}, verbs: {}, panes: { main: {label: "Tools", purpose: "Tools and saved work", draws: [], verbs: []}}, layout: pane("main"), stages: { main: {word: "Tools", panes: ["main"], verbs: []}}
};
