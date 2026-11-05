import { defineRouteGraph } from "@pe/agent-contracts";
// TODO: docs/features/routes/LEDGER.md#s6-declaration-chat Declaration 87 > 60 after kernel defaults. Thread lifecycle verbs, prompt inputs and readiness policy remain distinct.
import { chatSeedChoices } from "./seed-choices";
import { manyField } from "@pe/agent-contracts";
import { z } from "zod";
import {
  attachmentRefusal,
  emptyThreadHead,
  headRequests,
  machineInventory,
  pane,
  split,
  threadHeadSchema,
  threadWorkSnapshotSchema,
  promptRequestSchema,
  type DocumentRequest,
  type Machine,
  type PromptCapabilities,
  type Reading,
  type RouteGraph,
  peaSettingFields,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { pageVerb, rpcVerb } from "#/shell/verbs";
import { subscriptionSource } from "#/shell/readings-use";
import type { GraphMount, RouteAdapters } from "#/shell/mount";
import type { ReadingState } from "#/shell/readings";
import { targetClosure } from "./thread-navigation";
import { emptyPrompt } from "#/workbench/prompt";
import type { PromptRequest } from "#/workbench/provider/harness-client";

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
export type ChatHandle = GraphMount<ChatPage, unknown>;
const { id: _requestId, ...promptFields } = promptRequestSchema.shape;
const promptInput = z.object(promptFields);
const noInput = z.object({}).default({});
const value = (state?: ReadingState) => state?.value ?? state?.previous;

/** The provider owns thread lifecycle. The kernel admits, executes and records every press. */
export function chatGraph(deps: () => ChatRouteDeps, minOtherSize?: number): RouteGraph<ChatPage> {
  const threadRequest = z.object({ thread: z.string() });
  const sendRequest = z.object({ thread: z.string(), prompt: promptInput });
  const command = (
    key: string,
    label: string,
    run: () => Promise<void> | undefined,
    ready: () => string | null,
  ) =>
    rpcVerb(
      {
        key,
        input: threadRequest,
        run: async ({ thread }) => {
          if (thread !== deps().thread) throw Error("Thread changed; press again");
          await run();
          return {};
        },
      },
      { label, caller: "human", review: "none", input: noInput },
      {
        ready: () => ready(),
        intent: (scope) => ({ thread: String(scope.page.thread) }),
      },
    );
  return defineRouteGraph({
    directory: {
      path: "/pea",
      title: "Pea",
      label: "Workbench",
      exposure: "Main",
      runtimeNeed: "Host for conversation; Revit depends on the requested capability",
      icon: "MessageSquare",
      category: "Ask / automate",
      blurb: "The Pea agent workbench — chat and the context world inspector.",
      aliases: ["chat", "agent", "assistant", "threads"],
      listed: true,
      satellites: [],
      surfaces: {
        web: "full",
        pwa: "full",
        tray: "compact",
      },
    },
    key: "chat",
    address: "pea",
    name: "Pea",
    seeds: Object.fromEntries(
      Object.entries(chatSeedChoices).map(([name, title]) => [
        name,
        {
          title,
          load: () => import("./graph-seeds").then((m) => m.chatSeeds[name]!),
        },
      ]),
    ),
    subjectField: {
      field: "thread",
      noun: "thread",
      keyKind: "name",
      roster: "threads",
      detail: "head",
      pane: "threads",
    },
    fields: {
      thread: { ...field(z.string().default(""), {}) },
      selected: {
        ...manyField("name", { url: "replace", agent: "set" }),
        role: "selection",
      },
      mode: { ...field(z.enum(["threads", "world"]).default("threads"), {}) },
      ...peaSettingFields,
    },
    readings: {
      threads: { source: "threads", retire: "never" },
      threadWork: { source: "threadWork", retire: "never" },
      transcript: { source: "transcript", args: (page) => page.thread },
      head: {
        source: "head",
        args: (page) => page.thread,
      },
      machine: { source: "machine", args: (page) => page.thread },
      receipts: { source: "receipts", args: (page) => page.thread },
      capabilities: {
        source: "capabilities",
        args: (page) => page.thread,
      },
    },
    verbs: {
      send: rpcVerb(
        {
          key: "thread.prompt",
          input: sendRequest,
          run: async ({ thread, prompt }) => {
            if (thread !== deps().thread) throw Error("Thread changed; press again");
            await deps().send!(prompt);
            return {};
          },
        },
        { label: "send", caller: "human", review: "none", input: promptInput },
        {
          intent: (scope, input) => ({ thread: String(scope.page.thread), prompt: input }),
          ready: (scope, input) => {
            const current = deps();
            if (!current.send) return "Chat is not ready";
            if (!current.ready || scope.page.thread !== current.thread)
              return "Thread state is loading";
            if (current.sendRefusal) return current.sendRefusal;
            const targets = current.thread
              ? headRequests(
                  threadHeadSchema.safeParse(value(scope.readings.head)).data ?? emptyThreadHead,
                )
              : current.draftTarget
                ? [current.draftTarget]
                : [];
            const inventory = machineInventory(
              value(scope.readings.machine) as Machine | undefined,
            );
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
          },
        },
      ),
      stop: command(
        "thread.cancel",
        "stop",
        () => deps().cancel?.(),
        () => (!deps().cancel || !deps().thread ? "Chat is not ready" : null),
      ),
      fork: command(
        "thread.fork",
        "fork",
        () => deps().forkThread?.(),
        () =>
          !deps().forkThread
            ? "Chat is not ready"
            : !deps().thread
              ? "No thread to fork yet"
              : deps().running
                ? "Fork after the running turn ends"
                : null,
      ),
      threads: pageVerb(
        { label: "Threads mode", input: noInput, chord: "Mod+1" },
        { page: () => ({ mode: "threads" }) },
      ),
      world: pageVerb(
        { label: "World mode", input: noInput, chord: "Mod+2" },
        { page: () => ({ mode: "world" }) },
      ),
    },
    panes: {
      threads: {
        label: "threads",
        purpose: "Choose a conversation",
        frame: { header: false, flush: true, scroll: "clip" },
      },
      chat: {
        label: "chat",
        purpose: "Read and compose",
        draws: ["head", "machine", "receipts", "capabilities"],
        frame: { header: false, flush: true, scroll: "clip" },
      },
    },
    layout: split(
      "chat-threads",
      { axis: "h", sized: "start", size: 300, minSize: 240, minOtherSize, persist: "pe.sideWidth" },
      pane("threads"),
      pane("chat"),
    ),
    stages: {
      conversation: {
        word: "Conversation",
        verbs: ["threads", "world"],
      },
    },
  });
}

export function chatAdapters(navigate: () => void): RouteAdapters<ChatPage, unknown> {
  return {
    sources: {
      transcript: subscriptionSource({
        request: (ctx) => ({ kind: "thread", thread: String(ctx.args || "draft") }),
        decode: (value) => value,
      }),
      threads: subscriptionSource({
        request: () => ({ kind: "threads" }),
        decode: (value) => value,
      }),
      threadWork: subscriptionSource({
        request: () => ({ kind: "thread-work" }),
        decode: (value) => threadWorkSnapshotSchema.parse(value),
      }),
      ...Object.fromEntries(
        (["head", "machine", "receipts", "capabilities"] as const).map((id) => {
          const live = subscriptionSource({
            request: (ctx) =>
              id === "head"
                ? { kind: "thread-head", thread: String((ctx.page as ChatPage).thread || "draft") }
                : { kind: id },
            decode: (value) => value,
          });
          return [id, live];
        }),
      ),
    },
    binding: (_id, row) => ({ subject: null, args: row ?? {} }),
    navigate,
    bodies: {},
  };
}

/** Contract Reading projection for existing document and composer instruments. */
export function chatReading<T = unknown>(owner: ChatHandle, id: ChatReading): Reading<T> {
  const state = owner.readings.get(id);
  const observation = value(state) as T | undefined;
  if (state.status === "failed")
    return {
      state: "failed",
      message: state.error ?? "Reading failed",
      ...(observation === undefined ? {} : { previous: observation }),
    };
  if (observation !== undefined)
    return state.current
      ? { state: "ready", observation }
      : { state: "stale", previous: observation, reason: "dirtied" };
  return state.status === "absent"
    ? { state: "absent" }
    : { state: "loading", requestId: `chat.${id}.${state.version}`, deadline: Infinity };
}
