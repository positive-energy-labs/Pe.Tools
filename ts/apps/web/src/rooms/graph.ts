import { defineRouteGraph } from "@pe/agent-contracts";
// TODO: docs/features/routes/LEDGER.md#s6-declaration-rooms Declaration 168 > 60 after kernel defaults. Partition/write/merge commands, anchored feedback and plan layers remain distinct.
import { z } from "zod";
import {
  gate,
  pane,
  split,
  routeAddress,
  routeStatePatchSchema,
  roomsRouteState,
  takeoffActions,
  roomEditAddress,
  type Mark,
  type RoomsRouteDocument,
  type RouteGraph,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { roomsAddress } from "../../../../packages/agent-contracts/src/routes/rooms";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { commandVerb, workVerb, queryVerb, prepareCommand } from "#/shell/verbs";
import { roomsQueries } from "./refresh";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";

export const roomsPageSchema = routeAddress("rooms").schema.extend({
  epoch: z.number().default(0),
});
export type RoomsPage = z.output<typeof roomsPageSchema>;
const fields = { ...threadListFields, ...roomsAddress.fields };
const request = <S extends z.ZodType>(schema: S) =>
  z.strictObject({
    request: schema,
    refusal: z.string().nullable().default(null),
  });
const merge = request(takeoffActions["rooms.merge"].input);
const command = { review: "shown" as const, effect: "command" as const };
const feedbackVerbs = Object.assign(
  (row: unknown) =>
    (row as { kind?: string })?.kind === "note"
      ? ["delete-note"]
      : (row as { kind?: string })?.kind === "merge"
        ? ["applyMark"]
        : [],
  { ids: ["delete-note", "applyMark"] },
);

export const roomsGraph: RouteGraph<RoomsPage, RoomsRouteDocument> = defineRouteGraph({
  directory: {
    path: "/rooms",
    title: "Rooms",
    label: "Manual J",
    exposure: "Preview",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    icon: "LayoutDashboard",
    category: "Calculate loads & airflow",
    blurb:
      "Split a level's plan view into room regions, stage each room's name, type and loads, and write them to the regions in Revit.",
    aliases: ["manual", "j", "loads", "regions"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
    resume: "document",
  },
  key: "rooms",
  address: "rooms",
  name: "Rooms",
  seeds: {
    plan: {
      title: "Room plan",
      load: () => import("./graph-seeds").then((m) => m.roomsSeeds["plan"]!),
    },
  },
  needs: "project",
  work: roomsRouteState.schema,
  subjectField: { field: "view", noun: "view", keyKind: "name", roster: "roster", detail: "snapshot", pane: "scope", },
  fields: {
    threadSearch: { ...fields.threadSearch, role: "query" },
    threadSort: { ...fields.threadSort, role: "query" },
    stage: { ...fields.stage, agent: false },
    view: { ...fields.view, agent: false },
    layers: { ...fields.layers, agent: false },
    show: { ...fields.show, role: "query", agent: false },
    viewport: fields.viewport,
    selected: { ...fields.selected, role: "selection" },
    epoch: {
      ...field(
        roomsPageSchema.shape.epoch,
        {},
        {
          encode: String,
          decode: Number,
        },
      ),
      role: "transient",
      url: false,
    },
  },
  workFields: {
    notes: { label: "notes" },
  },
  cells: [
    { segment: "edits", groupOf: (key) => [roomEditAddress(key).guid], nouns: ["room"] },
    {
      segment: "marks",
      groupOf: (key) => [key],
      nouns: ["mark"],
      noun: "room marks",
      show: (value) => (value as Mark).kind,
    },
  ],
  transition: (current, patch) => ({
    patch: {
      ...(patch.view !== undefined && patch.view !== current.view && patch.selected === undefined
        ? { selected: [], viewport: null }
        : {}),
      ...patch,
    },
  }),
  readings: {
    snapshot: {
      args: (p) => [p.view, p.epoch],
    },
    trace: {
      args: (p) => [p.view, p.epoch],
    },
    plan: {
      args: (p) => p.view,
    },
    receipts: {},
  },
  verbs: {
    refresh: queryVerb(roomsQueries["rooms.refresh"], {
      label: "refresh",
      input: z.object({}),
      review: "none",
      says: "Re-read Rooms and Work",
    }),
    edit: workVerb(
      {
        label: "Edit rooms Work",
        input: z.strictObject({
          patches: z.array(routeStatePatchSchema),
          expectedRevision: z.number().int(),
          refusal: z.string().nullable().default(null),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; edit the current room cell"),
        patches: (_, input) => input.patches,
      },
    ),
    "delete-note": workVerb(
      {
        label: "delete",
        input: z.strictObject({
          id: z.string(),
          expectedRevision: z.number().int(),
          refusal: z.string().nullable().default(null),
        }),
      },
      {
        ready: (scope, input) =>
          input.refusal ??
          (scope.snapshot.work?.handle.revision === input.expectedRevision
            ? null
            : "Work changed; read the note again"),
        patches: (_, input) => [{ path: ["notes", input.id] }],
      },
    ),
    partition: commandVerb(
      "rooms.partition",
      { ...command, label: "partition", input: request(takeoffActions["rooms.partition"].input) },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (_, input) => input.request,
        present: (result) => {
          const request = result as { rejected?: unknown[] };
          const count = request.rejected?.length ?? 0;
          return {
            sentence: "Partition this view into rooms.",
            rows: [`Keep ${count} rejected ${count === 1 ? "region" : "regions"} excluded.`],
          };
        },
        stage: (_, input) => input.request,
        intent: () => ({}),
      },
    ),
    apply: commandVerb(
      "rooms.write",
      { ...command, label: "apply", input: request(takeoffActions["rooms.write"].input) },
      {
        // TODO: docs/features/routes/LEDGER.md#s7-1319af9e7a shell/verbs needs admitted command-result Work patches to clear only the cells written.
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: async (scope, input) => {
          await prepareCommand(scope, "rooms.write.preview", {});
          return input.request;
        },
        intent: () => ({}),
      },
    ),
    merge: commandVerb(
      "rooms.merge",
      { ...command, label: "merge", input: merge },
      {
        lands: (result) => ({
          selected: [z.object({ value: z.object({ guid: z.string() }) }).parse(result).value.guid],
        }),
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (_, input) => input.request,
        stage: (_, input) => input.request,
        intent: () => ({}),
      },
    ),
    applyMark: commandVerb(
      "rooms.merge",
      { ...command, label: "apply mark", input: merge },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (_, input) => input.request,
        stage: (_, input) => input.request,
        intent: () => ({}),
      },
    ),
  },
  panes: {
    scope: {
      label: "Plan view",
      purpose: "Choose the level and plan view",
      draws: ["snapshot"],
    },
    plan: {
      label: "Plan",
      frame: { picture: true, scroll: "clip", flush: true },
      purpose: "Inspect rooms, solver layers, callouts and sketch feedback",
      draws: ["snapshot", "trace", "plan"],
      verbs: feedbackVerbs,
    },
    feedback: {
      label: "Feedback",
      frame: { scroll: "clip", flush: true },
      purpose: "Review anchored marks and notes",
      draws: ["snapshot"],
      verbs: feedbackVerbs,
    },
    regions: {
      label: "Regions",
      purpose: "Edit room names, designation and Manual J fields",
      draws: ["snapshot"],
    },
    history: {
      label: "History",
      history: { receipts: "receipts" },
      purpose: "Inspect this document's rooms receipts",
      draws: ["receipts"],
    },
  },
  layout: split(
    "rooms-scope",
    { axis: "v", sized: "start", size: 104, minSize: 104 },
    gate("editing", pane("scope")),
    split(
      "rooms-layout",
      { axis: "h", sized: "end", size: 760 },
      gate("editing", pane("plan")),
      split(
        "rooms-review",
        { axis: "v", sized: "start", size: 260 },
        gate("review", pane("feedback")),
        gate("editing", pane("regions")),
      ),
      gate("history", pane("history")),
    ),
  ),
  predicates: { editing: (p) => p.stage !== "history" },
  stages: {
    partition: {
      word: "Partitioning rooms",
      panes: ["scope", "plan", "regions"],
      verbs: ["partition", "refresh"],
    },
    review: {
      word: "Reviewing rooms",
      panes: ["scope", "plan", "feedback", "regions"],
      verbs: ["apply", "merge", "refresh"],
    },
    history: { word: "History", panes: ["history"], verbs: ["refresh"] },
  },
  stageOrder: ["partition", "review", "history"],
});
