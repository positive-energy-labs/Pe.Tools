import { pane, type RouteGraph } from "@pe/agent-contracts";
import { settingsAddress } from "../../../../packages/agent-contracts/src/routes/settings";
import { z } from "zod";
import { pageVerb } from "#/shell/verbs";
import { openSeeds } from "#/open/graph-seeds";

export type SettingsPage = {
  [K in keyof typeof settingsAddress.fields]: z.output<
    (typeof settingsAddress.fields)[K]["schema"]
  >;
};
export const settingsGraph: RouteGraph<SettingsPage> = {
  key: "settings",
  address: "settings",
  name: "Settings",
  seeds: Object.fromEntries(
    Object.entries(openSeeds).map(([name, seed]) => [
      name,
      {
        title: seed.title,
        readings: {
          machine: {
            reading: { state: "ready", observation: seed.readings.machine },
            fixture: true,
          },
        },
      },
    ]),
  ),
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
