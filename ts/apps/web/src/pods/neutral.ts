import { z } from "zod";
import {
  threadListFields,
  threadSearchDefault,
} from "../../../../packages/agent-contracts/src/routes/shared.ts";
import { commands, podMemberSchema, settingsRouteState } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { memberId, memberOf } from "./identity.ts";
import { editRefusal, saveRefusal, openRefusal, type PodsScope } from "./actions.ts";
import { selectedMember, siblingPath } from "./model.ts";
import {
  compositionInput,
  memberReadInput,
  runsReadInput,
  runsInput,
  compositionReadInput,
} from "./inputs.ts";
import {
  podRowsSchema,
  podRunsSchema,
  memberReadSchema,
  compositionReadSchema,
} from "./schemas.ts";

const empty = { page: [], work: [], readings: [] } as const;
const deps = {
  page: ["pod", "path", "pendingDraft"],
  work: ["basis", "fields"],
  readings: ["member", "composition"],
} as const;
const adoptDeps = {
  page: ["pod", "path"],
  work: ["basis", "fields"],
  readings: ["member"],
} as const;
const field = <const R extends "query" | "device" | "transient", const S extends string, V>(
  role: R,
  schema: S,
  initial: V,
  url: "push" | "replace" | false,
  agent: "read" | "set" | "none",
) => ({ role, schema, codec: schema, initial, url, share: url !== false, agent }) as const;
const reading = <const E extends string>(entry: E) =>
  ({
    kind: "use",
    entry,
    deps: empty,
    demand: "visible",
    retain: { evidence: "scope", resource: "scope" },
    refresh: "dependencies",
  }) as const;
const command = <const E extends string, const I extends string, const R extends string>(
  entry: E,
  intent: I,
  ready: R,
  label: string,
) =>
  ({
    kind: "command",
    entry,
    intent,
    ready,
    label,
    input: "empty",
    review: "none",
    deps,
    captures: [],
  }) as const;
export const podsData = {
  version: 1,
  capabilities: ["work", "native-write"],
  key: "pods",
  address: "/pods",
  name: "Pods",
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
  identities: { member: { kind: "local", codec: "local" } },
  fields: {
    threadSearch: field("query", "threadSearch", threadSearchDefault(), "replace", "set"),
    threadSort: field("query", "threadSort", "", "replace", "set"),
    pod: field("query", "pod", "", "push", "read"),
    path: field("query", "path", "", "push", "read"),
    member: {
      role: "subject",
      schema: "member",
      codec: "member",
      initial: null,
      cardinality: "one",
      identity: "member",
      picker: { reading: "pods", options: "membersPick" },
      url: false,
      share: false,
      agent: "read",
    },
    selected: { role: "selection", kinds: ["member"] },
    runs: field("query", "runs", "member", "replace", "set"),
    mode: field("device", "mode", "form", false, "none"),
    pendingDraft: field("transient", "pendingDraft", false, false, "none"),
  },
  subject: {
    field: "member",
    noun: "member",
    roster: "pods",
    detail: "member",
    pane: "members",
    show: "memberShow",
  },
  work: { schema: "work", route: "pods", version: 1, migrations: {}, adopt: "open" },
  workSubject: "member",
  transition: "memberTransition",
  readings: {
    pods: reading("pods.list"),
    member: {
      ...reading("pods.member"),
      args: "memberArgs",
      deps: { ...empty, page: ["pod", "path"], work: ["basis"] },
    },
    status: reading("pods.status"),
    composition: {
      ...reading("pods.composition"),
      args: "compositionArgs",
      deps: { page: ["pod", "path"], work: ["basis", "fields"], readings: ["member", "status"] },
    },
    runs: {
      ...reading("pods.runs"),
      args: "runsArgs",
      deps: { ...empty, page: ["pod", "path", "runs"] },
    },
  },
  verbs: {
    select: {
      kind: "page",
      input: "memberRef",
      label: "Select member Work",
      review: "none",
      deps: empty,
      captures: [],
      fields: ["pod", "path"],
      patch: "selectMember",
    },
    mode: {
      kind: "page",
      input: "modeInput",
      label: "Editor mode",
      review: "none",
      deps: empty,
      captures: [],
      fields: ["mode"],
      patch: "modePatch",
    },
    runs: {
      kind: "page",
      input: "runsInput",
      label: "Change run scope",
      review: "none",
      deps: empty,
      captures: [],
      fields: ["runs"],
      patch: "runsPatch",
    },
    open: {
      ...command("settings.observe", "openIntent", "openReady", "open"),
      deps: adoptDeps,
      lands: "openLands",
    },
    adopt: {
      ...command("settings.observe", "adoptIntent", "adoptReady", "adopt disk bytes"),
      deps: adoptDeps,
      review: "shown",
      lands: "adoptLands",
    },
    save: command("settings.write", "saveIntent", "saveReady", "save"),
    "save-new": {
      ...command("settings.write", "saveNewIntent", "saveNewReady", "save as new"),
      lands: "saveNewLands",
    },
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit member",
      review: "none",
      deps,
      captures: [],
      ready: "editReady",
      patches: "editPatches",
    },
  },
  panes: {
    members: {
      label: "members",
      purpose: "Browse installed Pod members",
      draws: ["pods"],
      verbs: ["select"],
      body: "membersBody",
    },
    spec: {
      label: "spec",
      purpose: "Edit raw JSON or the schema form and review field proposals",
      draws: ["pods", "member", "composition"],
      verbs: ["mode", "edit"],
      body: "specBody",
    },
    runs: {
      label: "runs",
      purpose: "Inspect the member's receipts or every run in its Pod",
      draws: ["runs", "pods"],
      verbs: ["runs"],
      body: "runsBody",
    },
    history: {
      label: "History",
      purpose: "Inspect this Work's verb timeline",
      draws: [],
      verbs: [],
      history: {},
    },
  },
  layout: {
    kind: "split",
    id: "members",
    axis: "h",
    sized: "start",
    size: 300,
    minSize: 220,
    persist: "pods:members",
    children: [
      { kind: "pane", id: "members" },
      {
        kind: "split",
        id: "runs",
        axis: "h",
        sized: "end",
        size: 300,
        minSize: 220,
        persist: "pods:runs",
        children: [
          { kind: "pane", id: "spec" },
          {
            kind: "split",
            id: "history",
            axis: "v",
            sized: "end",
            size: 180,
            children: [
              { kind: "pane", id: "runs" },
              { kind: "pane", id: "history" },
            ],
          },
        ],
      },
    ],
  },
  stages: {
    browse: {
      word: "Browse",
      panes: ["members", "spec", "runs", "history"],
      verbs: ["open", "adopt", "save", "save-new"],
    },
  },
  stageOrder: ["browse"],
  cells: { fields: { segment: "fields", value: "field", groupOf: "fieldGroup", deps: empty } },
  workFields: { basis: { label: "read basis", internal: true } },
  predicates: {},
  seeds: { browse: { title: "Pods and family members", load: "browseSeed" } },
  needs: "nothing",
  optionalTarget: "document",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
export const podsSchemas = {
  threadSearch: threadListFields.threadSearch.schema,
  threadSort: threadListFields.threadSort.schema,
  pod: z.string().max(256),
  path: z.string().max(1024),
  member: z
    .custom<ReturnType<typeof memberId>>((v) => typeof v === "string" && memberOf(v) !== null)
    .nullable(),
  runs: z.enum(["member", "pod"]),
  mode: z.enum(["form", "raw"]),
  pendingDraft: z.boolean(),
  field: z.unknown(),
  memberRef: podMemberSchema,
  empty: z.object({}).default({}),
  work: settingsRouteState.schema,
  modeInput: z.object({ mode: z.enum(["form", "raw"]) }),
  runsInput: z.object({ runs: z.enum(["member", "pod"]) }),
  edit: z.object({ content: z.string() }),
};
const axes = {
  subject: "None",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const podsEntries = {
  "pods.list": { input: z.unknown(), output: podRowsSchema, axes },
  "pods.member": { input: memberReadInput, output: memberReadSchema.nullable(), axes },
  "pods.status": { input: z.unknown(), output: z.unknown(), axes },
  "pods.composition": {
    input: compositionReadInput,
    output: compositionReadSchema.nullable(),
    axes,
  },
  "pods.runs": {
    input: runsReadInput,
    output: podRunsSchema,
    axes,
  },
  "settings.observe": {
    input: commands["settings.observe"].input,
    output: z.unknown(),
    axes: commandCatalogAxes["settings.observe"],
  },
  "settings.write": {
    input: commands["settings.write"].input,
    output: z.unknown(),
    axes: commandCatalogAxes["settings.write"],
  },
};
const source = { module: "pods/neutral.ts", export: "podsNeutralBodies" };
type Bindings = BodyBindings<typeof podsData, typeof podsSchemas, typeof podsEntries>;
export function podsScope(ctx: {
  page: PodsScope["page"];
  work: unknown;
  readings: PodsScope["readings"];
  workBasis:
    | import("../../../../packages/agent-contracts/src/route-kernel-page.ts").InvocationToken
    | null;
}): PodsScope {
  return {
    page: ctx.page,
    work: settingsRouteState.schema.parse(ctx.work),
    workKey: ctx.workBasis?.token.scope.identity.work ?? null,
    readings: ctx.readings,
  };
}
export const podsNeutralBodies = {
  memberShow: { slot: "subject.show", kind: "show", source, run: (id) => memberOf(id)?.path ?? "" },
  memberTransition: {
    slot: "transition",
    kind: "transition",
    source,
    run: (current, patch, origin) => {
      if (!["member", "pod", "path"].some((key) => Object.hasOwn(patch, key)))
        return { ok: true, value: patch };
      const picked = patch.member !== undefined ? memberOf(patch.member) : null;
      const next = { ...patch, ...(picked ?? {}) };
      const member = selectedMember({ ...current, ...next });
      const changed =
        (next.pod !== undefined && next.pod !== current.pod) ||
        (next.path !== undefined && next.path !== current.path);
      return {
        ok: true,
        value: {
          ...next,
          member: member ? memberId(member) : null,
          ...(changed && origin.kind !== "restore" && { pendingDraft: false }),
        },
      };
    },
  },
  membersPick: {
    slot: "fields.member.picker.options",
    kind: "picker",
    source,
    run: (read) =>
      read.current
        ? read.value.flatMap((pod) =>
            pod.members.map((m) => ({
              id: memberId({ pod: pod.id, path: m.path }),
              label: m.path,
            })),
          )
        : [],
  },
  memberArgs: {
    slot: "readings.member.args",
    kind: "args",
    source,
    run: (ctx) => selectedMember(ctx.page),
  },
  compositionArgs: {
    slot: "readings.composition.args",
    kind: "args",
    source,
    run: (ctx) =>
      compositionInput(
        { page: ctx.page, work: settingsRouteState.schema.parse(ctx.work) },
        ctx.readings.member.value ?? null,
      ),
  },
  runsArgs: { slot: "readings.runs.args", kind: "args", source, run: (ctx) => runsInput(ctx.page) },
  selectMember: { slot: "verbs.select.patch", kind: "page", source, run: (_, input) => input },
  modePatch: { slot: "verbs.mode.patch", kind: "page", source, run: (_, input) => input },
  runsPatch: { slot: "verbs.runs.patch", kind: "page", source, run: (_, input) => input },
  openReady: {
    slot: "verbs.open.ready",
    kind: "ready",
    source,
    run: (ctx) => openRefusal(podsScope(ctx), false) ?? true,
  },
  adoptReady: {
    slot: "verbs.adopt.ready",
    kind: "ready",
    source,
    run: (ctx) => openRefusal(podsScope(ctx), true) ?? true,
  },
  editReady: {
    slot: "verbs.edit.ready",
    kind: "ready",
    source,
    run: (ctx) => editRefusal(podsScope(ctx)) ?? true,
  },
  saveReady: {
    slot: "verbs.save.ready",
    kind: "ready",
    source,
    run: (ctx) => saveRefusal(podsScope(ctx)) ?? true,
  },
  saveNewReady: {
    slot: "verbs.save-new.ready",
    kind: "ready",
    source,
    run: (ctx) => saveRefusal(podsScope(ctx)) ?? true,
  },
  openIntent: {
    slot: "verbs.open.intent",
    kind: "intent",
    source,
    run: (ctx) => ({
      member: selectedMember(ctx.page)!,
      sha256: ctx.readings.member.value?.sha256,
      replaceEdits: false,
    }),
  },
  adoptIntent: {
    slot: "verbs.adopt.intent",
    kind: "intent",
    source,
    run: (ctx) => ({
      member: selectedMember(ctx.page)!,
      sha256: ctx.readings.member.value?.sha256,
      replaceEdits: true,
    }),
  },
  openLands: {
    slot: "verbs.open.lands",
    kind: "lands",
    source,
    run: () => ({ pendingDraft: false }),
  },
  adoptLands: {
    slot: "verbs.adopt.lands",
    kind: "lands",
    source,
    run: () => ({ pendingDraft: false }),
  },
  saveIntent: { slot: "verbs.save.intent", kind: "intent", source, run: () => ({}) },
  saveNewIntent: {
    slot: "verbs.save-new.intent",
    kind: "intent",
    source,
    run: (ctx) => {
      const ref = selectedMember(ctx.page)!;
      return {
        destination: {
          pod: ref.pod,
          path: siblingPath(ref.path, z.uuid().parse(ctx.workBasis?.id)),
        },
      };
    },
  },
  saveNewLands: {
    slot: "verbs.save-new.lands",
    kind: "lands",
    source,
    run: (result) => {
      const { pod, path } = z
        .object({ file: podMemberSchema.extend({ sha256: z.string() }) })
        .parse(result).file;
      return { pod, path };
    },
  },
  editPatches: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (ctx, input) =>
      input.content === ctx.work.basis?.rawContent
        ? [{ path: ["fields", ""], op: "delete" }]
        : [{ path: ["fields", ""], value: { edit: { value: input.content } } }],
  },
  fieldGroup: {
    slot: "cells.fields.groupOf",
    kind: "group",
    source,
    run: (key) => [key || "raw JSON"],
  },
} satisfies Omit<Bindings, "membersBody" | "specBody" | "runsBody" | "browseSeed">;
export const podsHostModule = {
  data: podsData,
  schemas: podsSchemas,
  bodies: {},
  workState: settingsRouteState,
};
