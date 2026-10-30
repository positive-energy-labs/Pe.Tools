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
  key: "pods",
  address: "pods",
  name: "Pods",
  // TODO: Admit host-owned member Work without a Revit Target in validateRouteGraph.
  work: settingsRouteState.schema,
  // TODO: Normalize initial Page through transition so pod/path deep links select this Work.
  workSubject: "member",
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
  pick: false,
};
