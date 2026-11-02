import { manyField, pane, type RouteGraph } from "@pe/agent-contracts";
import { settingsAddress } from "../../../../packages/agent-contracts/src/routes/settings";
import { z } from "zod";
import { pageVerb } from "#/shell/verbs";

export type SettingsPage = {
  [K in keyof typeof settingsAddress.fields]: z.output<
    (typeof settingsAddress.fields)[K]["schema"]
  >;
};
export const settingsGraph: RouteGraph<SettingsPage> = {
  directory: {
  "path": "/settings",
  "title": "Settings",
  "label": "Settings",
  "exposure": "Main",
  "runtimeNeed": "Host machine configuration",
  "icon": "Settings2",
  "category": "Explore / maintain",
  "blurb": "This machine and every route's user settings: Revit sessions, update, sharing, Pea providers and approvals, host, notifications, appearance, diagnostics, and route preferences.",
  "aliases": [
    "machine",
    "Revit",
    "update",
    "share",
    "providers",
    "sign-in",
    "approvals",
    "host",
    "startup",
    "diagnostics",
    "theme",
    "route",
    "preferences",
    "slots",
    "colours"
  ],
  "listed": true,
  "satellites": [],
  "surfaces": {
    "web": "full",
    "pwa": "full",
    "tray": "compact"
  }
},
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
  subjectField: { field: "section", noun: "setting scope", keyKind: "name", cardinality: "one", roster: "scopes", detail: "machine", pane: "settings", show: (id) => id },
  fields: { selected: { ...manyField("name", {}), role: "selection" },
    section: { ...settingsAddress.fields.section, role: "subject" },
    session: { ...settingsAddress.fields.session, role: "pose" },
  },
  readings: { scopes: { kind: "derive", source: "settings.scopes", retire: "never" }, machine: { kind: "use", source: "settings.machine", retire: "never" } },
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
