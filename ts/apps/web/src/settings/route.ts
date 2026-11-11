import type { ContextOf } from "../route/defaults";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { SETTINGS_SECTIONS } from "../../../../packages/agent-contracts/src/settings-sections.ts";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import {
  settingsArgs,
  settingsValue,
} from "../../../../packages/agent-contracts/src/settings-read.ts";
export const loaded = read(hostRead(valueRead("settings.machine", settingsArgs, settingsValue)));
/** The Revit session row a link focuses. */
export const fields = { session: field(z.string(), "", "pose") };
/*
 * ADR 0035 rule 1: settings has no subject and an empty sheet. Its per-user setting fields have no
 * binding kind (rule 3 is closed to `parameter`, `store` and `local`), so the settings pane stays the
 * route's own drawing until a kind is ruled; `section` is the one route-owned query.
 */
export const query = {
  section: field(z.enum(["none", ...SETTINGS_SECTIONS]).optional(), undefined, "query", "push"),
};
export type SettingsContext = ContextOf<typeof fields & typeof query, typeof loaded, never, never>;
export const module = route({
  key: "settings",
  name: "Settings",
  needs: "host",
  host: "./host.ts",
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
  query,
  core: loaded,
  panes: {
    settings: {
      title: "Settings",
      purpose: "Configure this machine and every route",
      body: "scroll",
      draw: draw("scroll", () => import("./drawing.tsx"), "SettingsDrawing"),
    },
  },
  layout: paneLayout("settings"),
});
