import { z } from "zod";
import { SETTINGS_SECTIONS } from "../../../../packages/agent-contracts/src/settings-sections.ts";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route, type DrawContext } from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import {
  settingsArgs,
  settingsValue,
} from "../../../../packages/agent-contracts/src/settings-read.ts";
const loaded = {
  ...hostRead(valueRead("settings.machine", settingsArgs, settingsValue)),
  args: () => ({}),
};
const fields = {
  section: field(z.enum(["none", ...SETTINGS_SECTIONS]).optional(), undefined, "query", "push"),
  session: field(z.string(), "", "pose"),
};
export type SettingsContext = DrawContext<
  z.output<typeof settingsValue>,
  typeof fields,
  never,
  never
>;
export const module = route({
  key: "settings",
  name: "Settings",
  needs: "host",
  host: "../../../host/src/reads/settings.ts",
  directory: {
    group: "Explore / maintain",
    summary: "This machine and every route's user settings",
    label: "Settings",
    exposure: "Main",
    runtimeNeed: "Host machine configuration",
    icon: "Settings2",
    aliases: [
      "machine",
      "Revit",
      "update",
      "share",
      "providers",
      "approvals",
      "host",
      "theme",
      "preferences",
    ],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: "compact" },
  },
  fields,
  core: loaded,
  panes: {
    settings: {
      title: "Settings",
      purpose: "Configure this machine and every route",
      read: loaded,
      draw: draw(() => import("./drawing.tsx"), "SettingsDrawing"),
    },
  },
  layout: { kind: "pane", id: "settings" },
});
