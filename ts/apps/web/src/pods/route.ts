import * as contracts from "./contract.ts";
import type { ContextOf } from "../route/defaults";
import { handle } from "@pe/agent-contracts/handle";
import { read } from "../route/defaults";
import { z } from "zod";
import { memberWork, settingsRouteState, type Immutable } from "@pe/agent-contracts";
import { field, route, split, subjectSchema } from "../route/defaults";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import { podsArgs,
  podMemberCode,
  podMemberOfCode, } from "../../../../packages/agent-contracts/src/pods-read.ts";

/** The open member: the subject's one id, a `name` SubjectRef `[pod, path]` (ADR 0035 rule 2). */
export const member = (page: { member: Immutable<z.output<ReturnType<typeof subjectSchema>>> }) =>
  page.member.kind === "ids" ? podMemberOfCode(page.member.ids[0]) : null;
/** A verb on a member refuses before one is chosen: its command's input requires the member. */
const chosen = (page: Parameters<typeof member>[0]) => {
  const ref = member(page);
  if (!ref) throw Error("Choose a Pod member first");
  return ref;
};
export const loaded = read(
  hostRead(contracts.author),
  (page: Parameters<typeof member>[0] & { runs: "member" | "pod" }) => ({
    pod: member(page)?.pod ?? "",
    path: member(page)?.path ?? "",
    runs: page.runs,
  }),
);
export const inventory = read(hostRead(contracts.roster));
export const fields = {
  member: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push"),
};
export const query = { runs: field(podsArgs.shape.runs, "member", "query") };
type Page = typeof fields & typeof query;
export type PodsContext = ContextOf<Page, typeof loaded, typeof settingsRouteState, never>;
export type PodsRosterContext = ContextOf<Page, typeof inventory, typeof settingsRouteState, never>;
export const module = route({
  key: "pods",
  name: "Pods",
  needs: "host",
  host: "./host.ts",
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
  subject: {
    field: "member",
    noun: "member",
    multiple: false,
    pane: "members",
    read: inventory,
    options: (data) =>
      data.pods.flatMap((pod) =>
        pod.members.map((entry) => ({
          id: podMemberCode({ pod: pod.id, path: entry.path }),
          label: `${pod.name} · ${entry.path}`,
        })),
      ),
  },
  fields,
  query,
  core: loaded,
  // The core is the member's Goal: what is left before a run can consume the saved bytes.
  goal: loaded,
  reads: { inventory },
  title: (ctx) => {
    const ref = member(ctx.page.read());
    return ref ? `${ref.pod} · ${ref.path}` : null;
  },
  panes: {
    sheet: { title: "Member fields", purpose: "Edit the member’s arbitrary JSON over its saved bytes", body: "scroll", draw: draw("scroll", () => import("./fields.tsx"), "MemberFields") },
    members: {
      subjectList: true,
      title: "Members",
      purpose: "Browse installed Pod members",
      read: inventory,
      body: "scroll",
      draw: draw("scroll", () => import("./drawing.tsx"), "Members"),
    },
    runs: {
      title: "Runs",
      purpose: "Inspect member or Pod runs",
      body: "scroll",
      draw: draw("scroll", () => import("./drawing.tsx"), "Runs"),
    },
  },
  edits: {
    work: settingsRouteState,
    key: (page) => {
      const ref = member(page);
      return ref ? memberWork(ref) : null;
    },
    // Start opens empty Work; "Open saved bytes" then adopts the verified basis (settings.observe).
    seed: () => settingsRouteState.schema.parse({}),
    value: "work",
    owners: {},
    input: z.never(),
    patches: () => [],
    history: z.object({ label: z.string() }),
    describe: (history) => ({ label: history.label }),
  },
  verbs: {
    open: {
      handle: handle("settings.observe"),
      label: "Open saved bytes",
      input: ({ page, value }) => ({
        member: chosen(page),
        sha256: value?.member?.sha256,
        replaceEdits: false,
      }),
    },
    adopt: {
      handle: handle("settings.observe"),
      label: "Adopt disk bytes and replace edits",
      input: ({ page, value }) => ({
        member: chosen(page),
        sha256: value?.member?.sha256,
        replaceEdits: true,
      }),
    },
    save: { handle: handle("settings.write"), label: "Save staged member", input: () => ({}) },
    saveNew: {
      handle: handle("settings.write"),
      label: "Save as new member",
      input: ({ page }) => {
        const ref = member(page);
        return ref ? { destination: { pod: ref.pod, path: ref.path.replace(/(\.json)?$/, `.${crypto.randomUUID()}.json`) } } : {};
      },
    },
  },
  band: ["open", "adopt", "save", "saveNew"],
  layout: split(
    "h",
    ["members", split("v", ["sheet",
      split("h", ["goal", "runs"], { id: "pods-results", size: 320, sized: "start" })], { id: "pods-detail", size: 240, sized: "end" })],
    { id: "pods-main", size: 300, sized: "start" },
  ),
});
