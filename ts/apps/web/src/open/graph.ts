import { z } from "zod";
import { instancesActions, pane, split, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { commandVerb, pageVerb } from "#/shell/verbs";
import { EMPTY_DRAFT } from "./model";

const draft = z
  .object({
    doc: z.string().nullable(),
    target: z.string().nullable(),
    year: z.number().int().nullable(),
    owner: z.enum(["you", "pea"]),
    addins: z.enum(["on", "off"]),
    detach: z.boolean(),
    links: z.enum(["refuse", "allow"]),
  })
  .default(() => ({ ...EMPTY_DRAFT }));
const table = z
  .object({
    query: z.string(),
    sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
    hiddenColumns: z.array(z.string()).optional(),
  })
  .default(() => ({ query: "", sorts: [] }));
export const openPageSchema = z.object({
  epoch: z.number().default(0),
  draft,
  table,
});
export type OpenPageState = z.output<typeof openPageSchema>;
const guarded = <S extends z.ZodType>(schema: S) =>
  z.object({ request: schema, refusal: z.string().nullable().default(null) });
const rowVerbs = Object.assign(
  (row: unknown) => {
    const key = (row as { key?: string })?.key;
    return key && ["open", "start", "stop", "restart", "close"].includes(key) ? [key] : [];
  },
  { ids: ["open", "start", "stop", "restart", "close"] },
);

export const openGraph: RouteGraph<OpenPageState> = {
  key: "instances",
  address: "open",
  name: "Open",
  seeds: {
    refresh: {
      title: "the patch bay: your Revit 2025, two of Pea's, recents 2022 to 2027",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["refresh"]!),
    },
    "patch-bay": {
      title: "patch-bay",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["patch-bay"]!),
    },
    "controlled-hot": {
      title: "controlled-hot",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["controlled-hot"]!),
    },
    "observed-icon": {
      title: "observed-icon",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["observed-icon"]!),
    },
    "background-booting": {
      title: "background-booting",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["background-booting"]!),
    },
    "blocked-plan": {
      title: "blocked-plan",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["blocked-plan"]!),
    },
    "waiting-plan": {
      title: "waiting-plan",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["waiting-plan"]!),
    },
    "receipt-handoff": {
      title: "receipt-handoff",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["receipt-handoff"]!),
    },
    "update-downloading": {
      title: "update-downloading",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["update-downloading"]!),
    },
    "update-failed": {
      title: "update-failed",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["update-failed"]!),
    },
    "update-check-failed": {
      title: "update-check-failed",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["update-check-failed"]!),
    },
    disconnected: {
      title: "disconnected",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["disconnected"]!),
    },
    "no-revit": {
      title: "no-revit",
      load: () => import("./graph-seeds").then((m) => m.openSeeds["no-revit"]!),
    },
  },
  fields: {
    epoch: {
      ...field(openPageSchema.shape.epoch, {}, { encode: String, decode: Number }),
      role: "transient",
      url: false,
    },
    draft: {
      editor: "pane",
      ...field(draft, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "draft",
      url: false,
    },
    table: {
      editor: "pane",
      ...field(table, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "query",
      url: false,
    },
  },
  readings: {
    machine: {
      kind: "use",
      source: "open.machine",
      retire: "page",
      args: (p) => p.epoch,
    },
    recents: {
      kind: "use",
      source: "open.recents",
      retire: "page",
      args: (p) => p.epoch,
    },
    threads: { kind: "use", source: "open.threads", retire: "page", args: (p) => p.epoch },
    receipts: {
      kind: "use",
      source: "open.receipts",
      retire: "page",
      args: (p) => p.epoch,
    },
    world: { kind: "feed", source: "open.world", retire: "page", args: (p) => p.epoch },
  },
  verbs: {
    refresh: pageVerb(
      { label: "refresh", input: z.object({}) },
      { page: (scope) => ({ epoch: Number(scope.page.epoch) + 1 }) },
    ),
    open: commandVerb(
      "instances.open",
      {
        label: "Open document",
        input: guarded(instancesActions["instances.open"].input),
        review: "none",
        caller: "human",
      },
      { waitSeconds: 30, ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
    start: commandVerb(
      "instances.start",
      {
        label: "Start Revit",
        input: guarded(instancesActions["instances.start"].input),
        review: "none",
        caller: "human",
      },
      { waitSeconds: 30, ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
    stop: commandVerb(
      "instances.stop",
      {
        label: "Stop Revit",
        input: guarded(instancesActions["instances.stop"].input),
        review: "none",
        caller: "human",
      },
      { waitSeconds: 30, ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
    restart: commandVerb(
      "instances.restart",
      {
        label: "Restart Revit",
        input: guarded(instancesActions["instances.restart"].input),
        review: "none",
        caller: "human",
      },
      { waitSeconds: 30, ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
    close: commandVerb(
      "instances.close",
      {
        label: "Close document",
        input: guarded(instancesActions["instances.close"].input),
        review: "none",
        caller: "human",
      },
      { waitSeconds: 30, ready: (_, input) => input.refusal, intent: (_, input) => input.request },
    ),
  },
  panes: {
    bay: {
      label: "Documents and Revits",
      purpose: "Patch a document into a Revit, review its consequences, then press",
      draws: ["machine", "recents", "threads", "world"],
      verbs: rowVerbs,
    },
    history: {
      label: "History",
      purpose: "Inspect lifecycle receipts and world events",
      draws: ["receipts"],
      verbs: [],
      history: { receipts: "receipts" },
    },
  },
  layout: split("open-body", { axis: "v", sized: "end", size: 140 }, pane("bay"), pane("history")),
  stages: { open: { word: "Opening", panes: ["bay", "history"], verbs: ["refresh"] } },
};
