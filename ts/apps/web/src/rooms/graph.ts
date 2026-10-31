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
import { commandVerb, workVerb, queryVerb } from "#/shell/verbs";
import { roomsQueries } from "./refresh";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";

export const roomsPageSchema = routeAddress("rooms").schema.extend({
  selected: z.array(z.string()).default([]),
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

export const roomsGraph: RouteGraph<RoomsPage, RoomsRouteDocument> = {
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
  fields: {
    threadSearch: { ...fields.threadSearch, role: "query" },
    threadSort: { ...fields.threadSort, role: "query" },
    stage: { ...fields.stage, role: "stage", agent: false },
    view: { ...fields.view, role: "subject", agent: false },
    layers: { ...fields.layers, role: "pose", agent: false },
    focus: { ...fields.focus, role: "selection", agent: false },
    show: { ...fields.show, role: "query", agent: false },
    card: { ...fields.card, role: "selection", agent: false },
    viewport: { ...fields.viewport, role: "pose" },
    selected: {
      ...field(
        roomsPageSchema.shape.selected,
        {},
        {
          encode: JSON.stringify,
          decode: JSON.parse,
        },
      ),
      role: "transient",
      url: false,
    },
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
      kind: "use",
      source: "rooms.snapshot",
      retire: "page",
      args: (p) => [p.view, p.epoch],
    },
    trace: {
      kind: "use",
      source: "rooms.trace",
      retire: "page",
      args: (p) => [p.view, p.epoch],
    },
    plan: {
      kind: "use",
      source: "rooms.plan",
      retire: "page",
      args: (p) => p.view,
    },
    receipts: { kind: "use", source: "rooms.receipts", retire: "target" },
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
        intent: (_, input) => input.request,
      },
    ),
    apply: commandVerb(
      "rooms.write",
      { ...command, label: "apply", input: request(takeoffActions["rooms.write"].input) },
      {
        // TODO: shell/verbs needs admitted command-result Work patches to clear only the cells written.
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (_, input) => input.request,
        intent: (_, input) => input.request,
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
        intent: (_, input) => input.request,
      },
    ),
    applyMark: commandVerb(
      "rooms.merge",
      { ...command, label: "apply mark", input: merge },
      {
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: (_, input) => input.refusal,
        prepare: (_, input) => input.request,
        intent: (_, input) => input.request,
      },
    ),
  },
  panes: {
    scope: {
      label: "Plan view",
      purpose: "Choose the level and plan view",
      draws: ["snapshot"],
      verbs: [],
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
      verbs: [],
    },
    history: {
      label: "History",
      history: { receipts: "receipts" },
      purpose: "Inspect this document's rooms receipts",
      draws: ["receipts"],
      verbs: [],
    },
  },
  layout: split(
    "rooms-scope",
    { axis: "v", sized: "start", size: 32 },
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
};
