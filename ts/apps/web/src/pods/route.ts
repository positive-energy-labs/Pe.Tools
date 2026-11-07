import { sessionCommand } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { z } from "zod";
import { memberWork, settingsRouteState } from "@pe/agent-contracts";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route, split } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import {
  podsArgs,
  podsValue,
  podsRosterValue,
  podMemberOfPage as member,
} from "../../../../packages/agent-contracts/src/pods-read.ts";
export { member };
export const loaded = read(hostRead(valueRead("pods.author", podsArgs, podsValue)), (page: z.output<typeof podsArgs>) => ({ pod: page.pod, path: page.path, runs: page.runs }));
export const inventory = read(hostRead(valueRead("pods.roster", z.object({}), podsRosterValue)));
export const fields = {
  pod: field(z.string(), "", "query", "push"),
  path: field(z.string(), "", "query", "push"),
  runs: field(podsArgs.shape.runs, "member", "query"),
  mode: field(z.enum(["form", "raw"]), "form", "pose"),
};
export type { Context as PodsContext } from "./context.generated";
import type { PaneContext } from "./context.generated";
export type PodsRosterContext = PaneContext<"members">;
export const module = route({
  key: "pods",
  name: "Pods",
  needs: "host",
  host: "../../../host/src/reads/pods.ts",
  directory: {
    group: "Ask / automate",
    summary: "Author a Pod member and inspect its runs.",
    label: "Pods",
    exposure: "Preview",
    runtimeNeed: "Host catalogue; Revit depends on the pod",
    icon: "Settings2",
    aliases: ["Pods"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields,
  core: loaded,
  reads: { inventory },
  panes: {
    members: {
      title: "Members",
      purpose: "Browse installed Pod members",
      read: inventory,
      draw: draw(() => import("./drawing.tsx"), "Members"),
    },
    spec: {
      title: "Spec",
      purpose: "Edit saved member Work",
      draw: draw(() => import("./drawing.tsx"), "Spec"),
    },
    runs: {
      title: "Runs",
      purpose: "Inspect member or Pod runs",
      draw: draw(() => import("./drawing.tsx"), "Runs"),
    },
  },
  edits: {
    work: settingsRouteState,
    key: (page) => {
      const ref = member(page);
      return ref ? memberWork(ref) : null;
    },
    value: "work",
    owners: {},
    input: z.never(),
    patches: () => [],
    history: z.object({ label: z.string() }),
    describe: (history) => ({ label: history.label }),
  },
  commands: {
    open: {
      ...sessionCommand("settings.observe"),
      label: "Open saved bytes",
      input: ({ page, value }) => ({
        member: member(page),
        sha256: value?.member?.sha256,
        replaceEdits: false,
      }),
    },
    adopt: {
      ...sessionCommand("settings.observe"),
      label: "Adopt disk bytes and replace edits",
      input: ({ page, value }) => ({
        member: member(page),
        sha256: value?.member?.sha256,
        replaceEdits: true,
      }),
    },
    save: { ...sessionCommand("settings.write"), label: "Save staged member", input: () => ({}) },
    saveNew: {
      ...sessionCommand("settings.write"),
      label: "Save as new member",
      input: ({ page }) => ({
        destination: {
          pod: page.pod,
          path: page.path.replace(/(\.json)?$/, `.${crypto.randomUUID()}.json`),
        },
      }),
    },
  },
  layout: split(
    "h",
    ["members", split("v", ["spec", "runs"], { id: "pods-detail", size: 240, sized: "end" })],
    { id: "pods-main", size: 300, sized: "start" },
  ),
});
