import { z } from "zod";
import {
  attachmentRefusal,
  emptyThreadHead,
  headRequests,
  machineInventory,
  threadHeadSchema,
  threadWorkSnapshotSchema,
  peaSettingFields,
  type DocumentRequest,
  type Machine,
  type PromptCapabilities,
  type Reading,
} from "@pe/agent-contracts";
import type { PromptRequest } from "#/workbench/provider/harness-client";
import type { AdmittedMount } from "#/shell/admitted-mount";
import type {
  PagePort,
  FieldControls,
} from "../../../../packages/agent-contracts/src/route-kernel-page";
import { subscriptionSource } from "#/shell/readings-use";
import { identityCodecs } from "../../../../packages/agent-contracts/src/route-kernel-codecs";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { targetClosure } from "./thread-navigation";
import { emptyPrompt } from "#/workbench/prompt";
import { chatSeedChoices } from "./seed-choices";
import { chatLocalSchemas } from "./local";

export type ChatReading = "head" | "machine" | "receipts" | "capabilities";
export interface ChatRouteDeps {
  thread: string;
  ready?: boolean;
  running?: boolean;
  send?: (input: PromptRequest) => Promise<void>;
  cancel?: () => Promise<void>;
  newThread?: () => Promise<void>;
  forkThread?: () => Promise<void>;
  sendRefusal?: string;
  promptCapabilities?: PromptCapabilities | null;
  providerName?: string;
  draftTarget?: DocumentRequest | null;
}
export type ChatPage = { thread: string; selected: string[] | "all"; mode: "threads" | "world" };
export type ChatHandle = Omit<AdmittedMount, "page" | "controls"> & {
  readonly fixture: boolean;
  page: PagePort<typeof chatData, typeof chatSchemas>;
  controls: FieldControls<typeof chatData, typeof chatSchemas>;
};
export function threadIdentity(thread: string) {
  if (!thread) return null;
  const result = identityCodecs.local.encode({ namespace: "chat", subject: thread });
  if (!result.ok) throw Error(result.reason);
  return result.value;
}
export const threadName = (id: unknown): string =>
  id
    ? identityCodecs.local.parts(id as NonNullable<ReturnType<typeof threadIdentity>>).subject
    : "";
export function selectedThreads(
  selected: "all" | readonly { id: string }[],
  threads: readonly { id: string }[],
) {
  return selected === "all"
    ? threads.map((thread) => thread.id)
    : selected.map((item) => threadName(item.id));
}
export const chatSchemas = {
  ...chatLocalSchemas,
  thread: z
    .custom<NonNullable<ReturnType<typeof threadIdentity>>>(
      (v) => typeof v === "string" && identityCodecs.local.decode(v).ok,
    )
    .nullable(),
  mode: z.enum(["threads", "world"]),
  empty: z.object({}).default({}),
  prompt: chatLocalSchemas.promptCommand.shape.prompt,
  autoApprove: peaSettingFields.autoApprove.schema,
};
const deps = { page: [], work: [], readings: [] };
const reading = (entry: string) => ({
  kind: "use" as const,
  entry,
  deps,
  demand: "visible" as const,
  retain: { evidence: "scope" as const, resource: "scope" as const },
  refresh: "dependencies" as const,
});
const local = <
  const E extends string,
  const I extends string,
  const R extends string,
  const S extends keyof typeof chatSchemas = "empty",
>(
  entry: E,
  intent: I,
  ready: R,
  input: S = "empty" as S,
) => ({
  kind: "local" as const,
  entry,
  intent,
  ready,
  input,
  label: intent,
  review: "none" as const,
  deps: {
    ...deps,
    page: ["thread"] as const,
    readings: intent === "send" ? (["head", "machine"] as const) : ([] as const),
  },
  captures: [],
});
export const chatData = {
  version: 1,
  capabilities: ["local"],
  key: "chat",
  address: "/pea",
  name: "Pea",
  directory: {
    group: "Ask / automate",
    summary: "The Pea agent workbench and context world inspector.",
    label: "Workbench",
    exposure: "Main",
    runtimeNeed: "Host for conversation; Revit depends on the requested capability",
    icon: "MessageSquare",
    aliases: ["chat", "agent", "assistant", "threads"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: "compact" },
  },
  identities: { thread: { kind: "local", codec: "local" } },
  fields: {
    thread: {
      role: "subject",
      schema: "thread",
      codec: "thread",
      initial: null,
      cardinality: "one",
      identity: "thread",
      picker: { reading: "threads", options: "threadsPick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["thread"], allowAll: true },
    mode: {
      role: "query",
      schema: "mode",
      codec: "mode",
      initial: "threads",
      url: "replace",
      share: true,
      agent: "set",
    },
    autoApprove: { role: "setting", schema: "autoApprove", codec: "autoApprove", initial: true },
  },
  subject: { field: "thread", noun: "thread", roster: "threads", detail: "head", pane: "threads" },
  local: {
    "thread.prompt": { input: "promptCommand", output: "acknowledged" },
    "thread.cancel": { input: "threadCommand", output: "acknowledged" },
    "thread.fork": { input: "threadCommand", output: "acknowledged" },
  },
  readings: {
    threads: reading("threads"),
    threadWork: reading("threadWork"),
    transcript: {
      ...reading("transcript"),
      args: "transcriptArgs",
      deps: { ...deps, page: ["thread"] },
    },
    head: { ...reading("head"), args: "headArgs", deps: { ...deps, page: ["thread"] } },
    machine: reading("machine"),
    receipts: reading("receipts"),
    capabilities: reading("capabilities"),
  },
  verbs: {
    send: local("thread.prompt", "send", "sendReady", "prompt"),
    stop: local("thread.cancel", "stop", "stopReady"),
    fork: local("thread.fork", "fork", "forkReady"),
    threads: {
      kind: "page",
      input: "empty",
      label: "Threads mode",
      review: "none",
      deps,
      captures: [],
      fields: ["mode"],
      patch: "threadsMode",
      chord: "Mod+1",
    },
    world: {
      kind: "page",
      input: "empty",
      label: "World mode",
      review: "none",
      deps,
      captures: [],
      fields: ["mode"],
      patch: "worldMode",
      chord: "Mod+2",
    },
  },
  panes: {
    threads: {
      label: "threads",
      purpose: "Choose a conversation",
      draws: ["threads", "threadWork"],
      verbs: ["threads", "world"],
      body: "threadsBody",
      frame: { header: false, flush: true, scroll: "clip" },
    },
    chat: {
      label: "chat",
      purpose: "Read and compose",
      draws: ["transcript", "head", "machine", "receipts", "capabilities"],
      verbs: ["send", "stop", "fork"],
      body: "chatBody",
      frame: { header: false, flush: true, scroll: "clip" },
    },
  },
  layout: {
    kind: "split",
    id: "chat-threads",
    axis: "h",
    sized: "start",
    size: 300,
    minSize: 240,
    persist: "pe.sideWidth",
    children: [
      { kind: "pane", id: "threads" },
      { kind: "pane", id: "chat" },
    ],
  },
  stages: {
    conversation: { word: "Conversation", panes: ["threads", "chat"], verbs: ["threads", "world"] },
  },
  stageOrder: ["conversation"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: Object.fromEntries(
    Object.entries(chatSeedChoices).map(([name, title]) => [name, { title, load: `seed-${name}` }]),
  ) as { [K in keyof typeof chatSeedChoices]: { title: string; load: `seed-${K}` } },
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
export function chatSources() {
  return {
    transcript: subscriptionSource({
      request: (ctx) => ({ kind: "thread", thread: String(ctx.args || "draft") }),
      decode: (v) => v,
    }),
    head: subscriptionSource({
      request: (ctx) => ({ kind: "thread-head", thread: String(ctx.args || "draft") }),
      decode: (v) => v,
    }),
    threads: subscriptionSource({ request: () => ({ kind: "threads" }), decode: (v) => v }),
    threadWork: subscriptionSource({
      request: () => ({ kind: "thread-work" }),
      decode: (v) => threadWorkSnapshotSchema.parse(v),
    }),
    ...Object.fromEntries(
      (["machine", "receipts", "capabilities"] as const).map((kind) => [
        kind,
        subscriptionSource({ request: () => ({ kind }), decode: (v) => v }),
      ]),
    ),
  };
}
export function sendReadiness(
  current: ChatRouteDeps,
  pageThread: unknown,
  readings: Readonly<Record<string, ReadingSnapshot<unknown>>>,
  input: PromptRequest,
) {
  if (!current.send) return "Chat is not ready";
  if (!current.ready || threadName(pageThread) !== current.thread) return "Thread state is loading";
  if (current.sendRefusal) return current.sendRefusal;
  const targets = current.thread
    ? headRequests(threadHeadSchema.safeParse(readings.head?.value).data ?? emptyThreadHead)
    : current.draftTarget
      ? [current.draftTarget]
      : [];
  const inventory = machineInventory(readings.machine?.value as Machine | undefined);
  if (targets.some((target) => targetClosure(target, inventory)))
    return "Its document is closed: choose a live document or clear the target";
  return (
    emptyPrompt(input) ??
    attachmentRefusal(
      input.attachments ?? [],
      current.promptCapabilities ?? null,
      current.providerName ?? "This harness",
    )
  );
}
export function chatReading<T = unknown>(
  owner: Pick<AdmittedMount, "readingStatus">,
  id: string,
): Reading<T> {
  const { snapshot, previous } = owner.readingStatus(id);
  const value = (snapshot.value ?? previous) as T | undefined;
  if (snapshot.status === "failed")
    return {
      state: "failed",
      message: snapshot.reason,
      ...(value === undefined ? {} : { previous: value }),
    };
  if (value !== undefined)
    return snapshot.current
      ? { state: "ready", observation: value }
      : { state: "stale", previous: value, reason: "dirtied" };
  return { state: "loading", requestId: `chat.${id}`, deadline: Infinity };
}
export const chatOutcome = (owner: Pick<AdmittedMount, "timeline">, id: string) =>
  owner
    .timeline()
    .filter((row) => row.verb === id)
    .flatMap((row) => ("outcome" in row && row.outcome ? [row.outcome] : []))
    .at(-1);
/** Await the owner's press, without keeping another result or pending store in the composer. */
export async function runChatCommand(
  owner: Pick<AdmittedMount, "invoke" | "subscribe" | "timeline">,
  id: "send" | "stop" | "fork",
  input: unknown = {},
): Promise<string | null> {
  try {
    const press = owner.invoke(id, input) as { kind: "local"; press: string };
    return await new Promise((resolve) => {
      const read = () => {
        const result = owner
          .timeline()
          .flatMap((row) => ("outcome" in row && row.outcome ? [row.outcome] : []))
          .find((row) => row.id === press.press);
        if (!result || result.state === "running" || result.state === "queued") return;
        release();
        resolve(result.state === "succeeded" ? null : (result.reason ?? result.state));
      };
      const release = owner.subscribe(read);
      read();
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
