import * as contracts from "./contract.ts";
import type { ContextOf } from "../route/defaults";
import { read } from "../route/defaults";
import { z } from "zod";
import { SETTINGS_SECTIONS } from "../../../../packages/agent-contracts/src/settings-sections.ts";
import { field, route } from "../route/defaults";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { split } from "../route/typed-route.ts";
import type { SheetSlot } from "../../../../packages/agent-contracts/src/slots/sheet.ts";
import { settingOwners } from "@pe/agent-contracts/setting-owners";

import {  } from "../../../../packages/agent-contracts/src/settings-read.ts";
export const loaded = read(hostRead(contracts.machine));
/** The Revit session row a link focuses. */
export const fields = { session: field(z.string(), "", "pose") };
/*
 * ADR 0035 rule 1, as amended by ADR 0037 rule 8 (homes MAP slice 6b): settings has no subject, and
 * its sheet lists every tiered setting a route declares, each with the home tier that served it and
 * "save at" for each tier. With no target model here, the project tier says it has no home; a route
 * with a target (/fans, /ducts) saves at it. The machine pane stays the route's own drawing: it
 * holds acts on this machine (Revit sessions, update, sharing, providers), not values in a home.
 */
export const settingsSheet = { bindings: Object.fromEntries(Object.values(settingOwners).flatMap(owner => owner.bindings.map(b => [b.name, { label: b.label, default: b.default, domain: b.domain, home: b.home, per: "route" as const }]))) } as const satisfies SheetSlot;
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
  sheet: settingsSheet,
  panes: {
    settings: {
      title: "This machine",
      purpose: "Revit, updates, sharing, providers and appearance on this machine",
      body: "scroll",
      draw: draw("scroll", () => import("./drawing.tsx"), "SettingsDrawing"),
    },
  },
  layout: split("v", ["settings", "sheet"], { id: "settings-layout", size: 320, sized: "end" }),
});
