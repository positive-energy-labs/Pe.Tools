import { pane, type RouteGraph } from "@pe/agent-contracts";
import { settingsAddress } from "../../../../packages/agent-contracts/src/routes/settings";
import { z } from "zod";
import { pageVerb } from "#/shell/verbs";

export type SettingsPage = {
  [K in keyof typeof settingsAddress.fields]: z.output<
    (typeof settingsAddress.fields)[K]["schema"]
  >;
};
export const settingsGraph: RouteGraph<SettingsPage> = {
  key: "settings",
  address: "settings",
  name: "Settings",
  seeds: {
    refresh: {
      title: "the patch bay: your Revit 2025, two of Pea's, recents 2022 to 2027",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["refresh"]!),
    },
    "patch-bay": {
      title: "patch-bay",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["patch-bay"]!),
    },
    "controlled-hot": {
      title: "controlled-hot",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["controlled-hot"]!),
    },
    "observed-icon": {
      title: "observed-icon",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["observed-icon"]!),
    },
    "background-booting": {
      title: "background-booting",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["background-booting"]!),
    },
    "blocked-plan": {
      title: "blocked-plan",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["blocked-plan"]!),
    },
    "waiting-plan": {
      title: "waiting-plan",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["waiting-plan"]!),
    },
    "receipt-handoff": {
      title: "receipt-handoff",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["receipt-handoff"]!),
    },
    "update-downloading": {
      title: "update-downloading",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["update-downloading"]!),
    },
    "update-failed": {
      title: "update-failed",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["update-failed"]!),
    },
    "update-check-failed": {
      title: "update-check-failed",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["update-check-failed"]!),
    },
    disconnected: {
      title: "disconnected",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["disconnected"]!),
    },
    "no-revit": {
      title: "no-revit",
      load: () => import("./graph-seeds").then((m) => m.settingsSeeds["no-revit"]!),
    },
  },
  fields: {
    section: { ...settingsAddress.fields.section, role: "pose" },
    session: { ...settingsAddress.fields.session, role: "pose" },
  },
  readings: { machine: { kind: "use", source: "settings.machine", retire: "never" } },
  verbs: {
    "open-section": pageVerb(
      {
        label: "Open section",
        input: z.object({ section: settingsAddress.fields.section.schema }),
      },
      {
        page: (scope, input) => ({
          section: input.section ?? "none",
          session: input.section === "revit" ? scope.page.session : "",
        }),
      },
    ),
  },
  panes: {
    settings: {
      label: "Settings",
      purpose: "Configure this machine and every route",
      draws: ["machine"],
      verbs: [],
      frame: { header: false },
    },
  },
  layout: pane("settings"),
  stages: { settings: { word: "Settings", panes: ["settings"], verbs: [] } },
};
