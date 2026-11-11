import type { ContextOf } from "../route/defaults";
import { sessionCommand } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { z } from "zod";
import { memberWork, routeAddress, settingsRouteState, type Immutable } from "@pe/agent-contracts";
import { local } from "@pe/agent-contracts/slots";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route, split, subjectSchema } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
import { isSpecOf } from "../route/workflow.ts";

import {
  podsArgs,
  podsValue,
  podsRosterValue,
  podMemberCode,
  podMemberOfCode,
} from "../../../../packages/agent-contracts/src/pods-read.ts";

/** The open member: the subject's one id, a `name` SubjectRef `[pod, path]` (ADR 0035 rule 2). */
export const member = (page: { member: Immutable<z.output<ReturnType<typeof subjectSchema>>> }) =>
  page.member.kind === "ids" ? podMemberOfCode(page.member.ids[0]) : null;
export const loaded = read(
  hostRead(valueRead("pods.author", podsArgs, podsValue)),
  (page: Parameters<typeof member>[0] & { runs: "member" | "pod" }) => ({
    pod: member(page)?.pod ?? "",
    path: member(page)?.path ?? "",
    runs: page.runs,
  }),
);
export const inventory = read(hostRead(valueRead("pods.roster", z.object({}), podsRosterValue)));
export const fields = {
  member: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push"),
};
export const query = { runs: field(podsArgs.shape.runs, "member", "query") };
type Page = typeof fields & typeof query;
export type PodsContext = ContextOf<Page, typeof loaded, typeof settingsRouteState, never>;
export type PodsRosterContext = ContextOf<Page, typeof inventory, typeof settingsRouteState, never>;
type Value = z.output<typeof podsValue>;

/** RFC 6901: a top-level key as a JSON Pointer. */
const pointer = (key: string) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
const objectOf = (text: string | undefined): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse((text ?? "").replace(/^﻿/, ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const keyOf = (row: string) => row.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
/** The member's own scope only: a read for another member is never drawn as this one's. */
const current = (read: Value) => read.scope.pod && read.member ? read : null;

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
  /*
   * The member's Work as `local` bindings (ADR 0035 rule 3): one draft cell per top-level property, at
   * its JSON Pointer in the Work's `fields`; the saved bytes are the layer under it. A run reads the
   * saved file, so these cells never reach Revit and the sheet has no write verb; Save is the route's.
   */
  sheet: {
    draft: true,
    bindings: {
      fields: local(z.unknown(), "subject", {
        json: true,
        rows: (read: Value) => Object.keys((current(read) && objectOf(read.draft)) ?? {}).map(pointer),
        rowLabel: (_read: Value, row: string) => keyOf(row),
        model: (read: Value, row: string | undefined) => {
          const saved = objectOf(read.member?.content);
          return {
            value: row === undefined || !saved ? null : (saved[keyOf(row)] ?? null),
            ref: "saved file",
            ...(read.work?.basis ? {} : { refusal: "Open saved bytes before editing: this Work has no saved basis" }),
          };
        },
      }),
    },
    empty: (read: Value | null) => {
      const ref = read?.scope;
      if (!ref?.pod || !ref.path) return "Pick a member on the left to edit its Work";
      if (!ref.path.endsWith(".json")) return `${ref.path} is source, not a JSON spec; pick a .json member`;
      if (!read?.member) return `Reading ${ref.pod} · ${ref.path}`;
      return objectOf(read.draft) ? null : "The draft is not a JSON object; Pea can repair it as raw text";
    },
    from: (read: Value, search) =>
      read.member && isSpecOf(read.schemaRef, "/schemas/settings/FamilyFoundry/models.json")
        ? {
            says: "Open in Family",
            href: routeAddress("family").link({
              stage: "apply",
              pod: read.scope.pod,
              path: read.scope.path,
              ...(typeof search.thread === "string" ? { thread: search.thread } : {}),
            }),
          }
        : null,
  },
  panes: {
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
      input: ({ page }) => {
        const ref = member(page);
        return ref ? { destination: { pod: ref.pod, path: ref.path.replace(/(\.json)?$/, `.${crypto.randomUUID()}.json`) } } : {};
      },
    },
  },
  layout: split(
    "h",
    ["members", split("v", ["sheet", split("h", ["goal", "runs"], { id: "pods-results", size: 320, sized: "start" })], { id: "pods-detail", size: 240, sized: "end" })],
    { id: "pods-main", size: 300, sized: "start" },
  ),
});
