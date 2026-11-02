import {
  settingsRouteState,
  type RouteGraph,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import { podsFields, type PodsPage } from "./page";
import { podsVerbs } from "./verbs";
import { podsReadings, podsPanes, podsLayout } from "./declarations";
import { podsTransition } from "./actions";

export const podsGraph: RouteGraph<PodsPage, SettingsRouteDocument> = {
  directory: {
  "path": "/pods",
  "title": "Pods",
  "label": "Pods",
  "exposure": "Preview",
  "runtimeNeed": "Host catalogue; Revit depends on the pod",
  "icon": "Settings2",
  "category": "Ask / automate",
  "blurb": "Every installed pod — browse members, edit a spec as a form or raw JSON, and see the runs filed against it.",
  "aliases": [
    "Pods"
  ],
  "listed": true,
  "satellites": [],
  "surfaces": {
    "web": "full",
    "pwa": "full",
    "tray": false
  }
},
  key: "pods",
  address: "pods",
  name: "Pods",
  seeds: {
    browse: {
      title: "Pods and family members",
      load: () => import("./graph-seeds").then((m) => m.podsSeeds["browse"]!),
    },
  },
  work: settingsRouteState.schema,
  workSubject: "member",
  optionalTarget: "document",
  observe: ["open"],
  fields: podsFields,
  transition: podsTransition,
  cells: [
    { segment: "fields", groupOf: (key) => [key || "raw JSON"], nouns: ["field"], noun: "member" },
  ],
  readings: podsReadings,
  verbs: podsVerbs,
  panes: podsPanes,
  layout: podsLayout,
  stages: {
    browse: {
      word: "Browse",
      panes: ["members", "spec", "runs", "history"],
      verbs: ["open", "adopt", "save", "save-new"],
      teach:
        "Select a JSON member, open its Work, review edits and save; apply belongs to its product route.",
    },
  },

};
