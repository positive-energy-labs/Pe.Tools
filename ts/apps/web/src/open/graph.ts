import { z } from "zod";
import { instancesActions, pane, split, type RouteGraph } from "@pe/agent-contracts";
import { field, text } from "../../../../packages/agent-contracts/src/route-field";
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
  demo: text(),
  live: text(),
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
  fields: {
    demo: {
      ...field(text(), {}, { encode: String, decode: String }),
      role: "transient",
      url: "replace",
    },
    live: {
      ...field(text(), {}, { encode: String, decode: String }),
      role: "transient",
      url: "replace",
    },
    epoch: {
      ...field(openPageSchema.shape.epoch, {}, { encode: String, decode: Number }),
      role: "transient",
      url: false,
    },
    draft: {
      ...field(draft, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "draft",
      url: false,
    },
    table: {
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
      args: (p) => [p.demo, p.live, p.epoch],
    },
    recents: {
      kind: "use",
      source: "open.recents",
      retire: "page",
      args: (p) => [p.demo, p.live, p.epoch],
    },
    threads: { kind: "use", source: "open.threads", retire: "page", args: (p) => [p.demo, p.live] },
    receipts: {
      kind: "use",
      source: "open.receipts",
      retire: "page",
      args: (p) => [p.demo, p.live, p.epoch],
    },
    world: { kind: "feed", source: "open.world", retire: "page", args: (p) => [p.demo, p.live] },
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
