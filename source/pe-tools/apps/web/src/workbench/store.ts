import { Cause, Effect, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { MastraClient, type AgentControllerThreadInfo } from "@mastra/client-js";
import {
  createWorkbenchState,
  selectPendingApprovals,
  type WorkbenchAccessLevel,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { z } from "zod";

import { createRouteStoreCore, VerbRefused } from "#/state/route-store";
import { peUrl, type WorkbenchEndpointConfig } from "./config";
import { hydrateWorkbenchState, type PeInspect } from "./adapter";
import { reduceWorkbench, runEndedCleanly, type WorkbenchUpdate } from "./reduce";
import { parseWireEvent, parseWireMessages, type WireEvent, type WireMessageContent } from "./wire";
import type { ThreadLandingApi } from "./land-thread";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  persisted: boolean;
  promptActive?: boolean;
  cwd?: string;
}

export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

export interface ChatSearch {
  readonly thread?: string;
  readonly mode: string;
  readonly turn?: number;
  readonly plugin?: "family" | "families" | "settings" | "parameter-links" | "schedule-grid";
  readonly target?: string;
  readonly prompt?: string;
  patch(partial: Partial<Omit<ChatSearch, "patch">>, replace?: boolean): void;
}

export interface ChatApi extends ThreadLandingApi {
  hydrate(threadId: string): Promise<WorkbenchState>;
  subscribe(onEvent: (event: WireEvent) => void, onError: (error: Error) => void): Promise<() => void>;
  deleteThread(threadId: string): Promise<void>;
  cloneThread(threadId: string): Promise<{ id: string }>;
  sendPrompt(text: string, attachments?: WorkbenchAttachment[]): Promise<void>;
  abort(): Promise<void>;
  rejectApproval(requestId: string): Promise<void>;
  resolveApproval(state: WorkbenchState, requestId: string, optionId?: string): Promise<void>;
  setModel(modelId: string): Promise<void>;
  setAccessLevel(accessLevel: WorkbenchAccessLevel): Promise<void>;
}

type Setter<A> = A | ((previous: A) => A);
type Density = "inspect" | "plain";
type WorldState = { density: Density; diff: boolean; open: Set<string>; openItems: Set<string> };

export function createChatStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  api: ChatApi;
  search: ChatSearch;
  land: (api: ThreadLandingApi) => Promise<string>;
}) {
  const core = createRouteStoreCore("chat", deps.registry);
  const threadId = deps.search.thread ?? "";
  const channel = workbenchStream(deps.api, threadId);
  const workbench = core.owned("slice/workbench", Atom.make(channel.stream));
  const state = core.owned(
    "view/state",
    Atom.make((get) => {
      const result = get(workbench);
      return AsyncResult.isSuccess(result) ? result.value : createWorkbenchState();
    }),
  );
  const loading = core.owned(
    "view/loading",
    Atom.make((get) => AsyncResult.isInitial(get(workbench))),
  );
  const sliceError = core.owned(
    "view/error",
    Atom.make((get) => {
      const result = get(workbench);
      return AsyncResult.isFailure(result) ? String(Cause.squash(result.cause)) : undefined;
    }),
  );
  const threads = core.owned(
    "view/threads",
    Atom.make((get): StoredThreadSummary[] =>
      get(state).threads.items.map((thread) => ({
        id: thread.threadId,
        title: thread.title?.trim() || shortId(thread.threadId),
        updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
        messageCount: 0,
        persisted: true,
        cwd: thread.cwd,
      })),
    ),
  );

  const paletteOpen = core.owned("page/palette-open", Atom.make(false));
  const sideOpen = core.owned("page/side-open", Atom.make(true));
  const pluginOpen = core.owned("page/plugin-open", Atom.make(Boolean(deps.search.plugin)));
  const lensIntent = core.owned(
    "page/lens-intent",
    Atom.make<{ inspectKey: string | null; following: boolean }>({ inspectKey: null, following: !deps.search.turn }),
  );
  const world = core.owned<Atom.Writable<WorldState>>(
    "page/world",
    Atom.make<WorldState>({ density: "inspect", diff: false, open: new Set(["system-prompt"]), openItems: new Set<string>() }),
  );
  const draft = core.owned(
    "page/composer",
    Atom.make<{ text: string; attachments: WorkbenchAttachment[] }>({ text: deps.search.prompt ?? "", attachments: [] }),
  );
  let promptTimer: ReturnType<typeof setTimeout> | undefined;

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const rehydrate = () => channel.hydrate();
  const current = () => channel.current();
  const running = () => {
    const status = current().uiStatus.overall.status;
    return status === "running" || status === "waiting";
  };
  const setDraft = (next: Setter<{ text: string; attachments: WorkbenchAttachment[] }>) => {
    set("set-draft", draft, next);
    if (promptTimer) clearTimeout(promptTimer);
    const value = deps.registry.get(draft);
    const prompt = value.text.trim();
    if (!prompt || prompt.length > 200 || value.attachments.length) {
      deps.search.patch({ prompt: undefined }, true);
      return;
    }
    promptTimer = setTimeout(() => deps.search.patch({ prompt }, true), 300);
  };

  const actions = {
    setPaletteOpen: (value: Setter<boolean>) => set("set-palette", paletteOpen, value),
    setSideOpen: (value: Setter<boolean>) => set("set-side", sideOpen, value),
    setPluginOpen: (value: Setter<boolean>) => set("set-plugin", pluginOpen, value),
    setLensIntent: (value: Setter<{ inspectKey: string | null; following: boolean }>) => set("set-lens", lensIntent, value),
    setWorld: (value: Setter<WorldState>) => set("set-world", world, value),
    setDraft,
    setMode: (mode: string) => deps.search.patch({ mode }),
    setTurn: (turn?: number) => deps.search.patch({ turn }, true),
    setPlugin: (plugin?: ChatSearch["plugin"]) => deps.search.patch({ plugin }),
    switchThread: (thread: string) => deps.search.patch({ thread }),
    async send(text: string, attachments?: WorkbenchAttachment[]) {
      return core.runVerb("send", async () => {
        if (running()) throw new VerbRefused("send");
        const prompt = text.trim();
        if (!prompt && !attachments?.length) return;
        channel.dispatch({
          type: "send",
          id: `local-user-${Date.now()}`,
          content: [
            ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
            ...attachmentsToContent(attachments),
          ],
        });
        try {
          await deps.api.sendPrompt(prompt, attachments);
        } catch (error) {
          channel.dispatch({ type: "end" });
          throw error;
        }
      }, ["workbench"]);
    },
    async cancel() {
      for (const approval of selectPendingApprovals(current())) {
        void deps.api.rejectApproval(approval.requestId).catch(() => undefined);
      }
      await deps.api.abort();
      channel.dispatch({ type: "end" });
    },
    async newThread() {
      return core.runVerb("new-thread", async () => {
        const id = (await deps.api.session.createThread()).id;
        deps.search.patch({ thread: id });
        return id;
      }, ["workbench"]);
    },
    async deleteThread(id: string) {
      return core.runVerb("delete-thread", async () => {
        await deps.api.deleteThread(id);
        if (id === threadId) deps.search.patch({ thread: await deps.land(deps.api) });
        else await rehydrate();
      }, ["workbench"]);
    },
    async cloneThread() {
      return core.runVerb("clone-thread", async () => {
        const clone = await deps.api.cloneThread(threadId);
        deps.search.patch({ thread: clone.id });
        return clone.id;
      }, ["workbench"]);
    },
    async resolveApproval(requestId: string, optionId?: string) {
      channel.dispatch({ type: "approval", requestId, optionId });
      return core.runVerb("resolve-approval", () => deps.api.resolveApproval(current(), requestId, optionId), ["workbench"]);
    },
    async setModel(modelId: string) {
      await core.runVerb("set-model", () => deps.api.setModel(modelId), ["workbench"]);
      channel.dispatch({ type: "model", modelId });
    },
    async setAccessLevel(accessLevel: WorkbenchAccessLevel) {
      await core.runVerb("set-access", () => deps.api.setAccessLevel(accessLevel), ["workbench"]);
      channel.dispatch({ type: "access", accessLevel });
    },
    refresh: rehydrate,
  };

  return {
    registry: deps.registry,
    search: deps.search,
    slices: { workbench },
    atoms: { state, threads, loading, sliceError, paletteOpen, sideOpen, pluginOpen, lensIntent, world, draft, busy: core.busy, failure: core.failure, receipt: core.receipt },
    actions,
    dispose() {
      if (promptTimer) clearTimeout(promptTimer);
      channel.dispose();
      core.dispose();
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

function workbenchStream(api: ChatApi, threadId: string) {
  let latest = createWorkbenchState();
  let closed = false;
  let dispatch = (update: WorkbenchUpdate) => {
    latest = reduceWorkbench(latest, update);
  };
  let hydrate: () => Promise<void> = async () => undefined;
  let unsubscribe: () => void = () => undefined;
  const stream = Stream.callback<WorkbenchUpdate, Error>((queue) => {
    const emit = (update: WorkbenchUpdate) => {
      if (closed) return;
      latest = reduceWorkbench(latest, update);
      Queue.offerUnsafe(queue, update);
    };
    dispatch = emit;
    hydrate = async () => emit({ type: "hydrate", state: await api.hydrate(threadId) });
    return Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          await hydrate();
          unsubscribe = await api.subscribe(
            (event) => {
              emit({ type: "wire", event });
              if (
                event.type === "thread_created" ||
                event.type === "thread_deleted" ||
                event.type === "thread_changed" ||
                runEndedCleanly(latest, event)
              ) void hydrate();
            },
            () => undefined,
          );
          return unsubscribe;
        },
        catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
      }),
      (close) => Effect.sync(close),
    );
  }).pipe(Stream.scan(createWorkbenchState(), reduceWorkbench));
  return {
    stream,
    current: () => latest,
    dispatch: (update: WorkbenchUpdate) => dispatch(update),
    hydrate: () => hydrate(),
    dispose() {
      closed = true;
      unsubscribe();
    },
  };
}

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });
type LiveClient = {
  controller: ReturnType<MastraClient["getAgentController"]>;
  session: ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;
  info: z.infer<typeof peInfoSchema>;
};
type ToolResume = string | { action: "approved" | "rejected"; feedback?: string };

export function createLiveChatApi(config: WorkbenchEndpointConfig): ChatApi {
  let clientPromise: Promise<LiveClient> | undefined;
  const client = () =>
    (clientPromise ??= (async () => {
      const response = await fetch(peUrl(config, "/info"));
      if (!response.ok) throw Error(`Workbench connection failed (${response.status}).`);
      const info = peInfoSchema.parse(await response.json());
      const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(info.controllerId);
      return { controller, session: controller.session(info.resourceId), info };
    })());
  const session = {
    listThreads: async () => (await client()).session.listThreads(),
    createThread: async () => (await client()).session.createThread(),
  };
  return {
    session,
    async hydrate(threadId) {
      const { controller, session: live, info } = await client();
      const bound = await live.state().catch(() => undefined);
      const needsSwitch = bound?.threadId !== threadId;
      if (needsSwitch) await live.switchThread(threadId).catch(() => undefined);
      const [threads, displayState, messages, inspect, models, modes] = await Promise.all([
        live.listThreads(),
        needsSwitch ? live.state().catch(() => undefined) : Promise.resolve(bound),
        live.listMessages(threadId).then(parseWireMessages).catch(() => []),
        fetchPeInspect(config),
        controller.listModels().catch(() => []),
        controller.listModes().catch(() => []),
      ]);
      return hydrateWorkbenchState({
        controllerId: info.controllerId,
        resourceId: info.resourceId,
        threadId,
        displayState,
        threads: toSummaries(threads),
        messages,
        inspect,
        models,
        modes,
      });
    },
    async subscribe(onEvent, onError) {
      const subscription = await (await client()).session.subscribe({
        onEvent: (raw) => {
          const event = parseWireEvent(raw);
          if (event) onEvent(event);
        },
        onError: (cause) => onError(cause instanceof Error ? cause : Error(String(cause))),
      });
      return subscription.unsubscribe;
    },
    async deleteThread(threadId) { await (await client()).session.deleteThread(threadId); },
    async cloneThread(threadId) { return (await client()).session.cloneThread({ sourceThreadId: threadId }); },
    async sendPrompt(text, attachments) {
      const files = toFiles(attachments);
      const response = await fetch(peUrl(config, "/messages"), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(files ? { message: text, files } : { message: text }),
      });
      if (!response.ok) throw Error(`${response.status} ${response.statusText}`);
    },
    async abort() { await (await client()).session.abort(); },
    async rejectApproval(requestId) { await rejectApproval((await client()).session, requestId); },
    async resolveApproval(state, requestId, optionId) {
      const live = (await client()).session;
      const reject = optionId?.startsWith("reject") ?? false;
      if (requestId.startsWith("tool-suspended:")) {
        const request = state.approvals.requests.find((item) => item.requestId === requestId);
        await live.respondToToolSuspension(
          requestId.slice("tool-suspended:".length),
          resumeDataForSuspension(request?.toolCall.title, request?.toolCall.rawOutput, reject),
        );
      } else {
        await live.approveTool(requestId.startsWith("tool-approval:") ? requestId.slice("tool-approval:".length) : requestId, !reject);
      }
    },
    async setModel(modelId) { await (await client()).session.switchModel(modelId); },
    async setAccessLevel(accessLevel) { await (await client()).session.setState({ yolo: accessLevel === "trusted", accessLevel }); },
  };
}

function toSummaries(threads: AgentControllerThreadInfo[]): StoredThreadSummary[] {
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title?.trim() || shortId(thread.id),
    updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
    messageCount: 0,
    persisted: true,
  })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function attachmentsToContent(attachments?: WorkbenchAttachment[]): WireMessageContent[] {
  return attachments?.map((attachment) => attachment.data
    ? { type: "image" as const, data: attachment.data, mimeType: attachment.mimeType, filename: attachment.name }
    : { type: "text" as const, text: `Attachment: ${attachment.name ?? "attachment"}` }) ?? [];
}

function toFiles(attachments?: WorkbenchAttachment[]) {
  const files = attachments?.flatMap((attachment) => {
    if (attachment.data) return [{ data: attachment.data, mediaType: attachment.mimeType ?? "application/octet-stream", ...(attachment.name ? { filename: attachment.name } : {}) }];
    if (attachment.text === undefined) return [];
    return [{ data: toBase64(attachment.text), mediaType: attachment.mimeType ?? "text/plain", ...(attachment.name ? { filename: attachment.name } : {}) }];
  });
  return files?.length ? files : undefined;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fetchPeInspect(config: WorkbenchEndpointConfig): Promise<PeInspect> {
  const response = await fetch(peUrl(config, "/inspect"), { headers: { Accept: "application/json" } });
  return response.ok ? (await response.json().catch(() => ({}))) as PeInspect : {};
}

async function rejectApproval(session: LiveClient["session"], requestId: string) {
  if (requestId.startsWith("tool-suspended:")) {
    await session.respondToToolSuspension(requestId.slice("tool-suspended:".length), "Rejected");
  } else {
    await session.approveTool(requestId.startsWith("tool-approval:") ? requestId.slice("tool-approval:".length) : requestId, false);
  }
}

function resumeDataForSuspension(toolName: string | undefined, payload: unknown, reject: boolean): ToolResume {
  if (toolName === "submit_plan") return reject ? { action: "rejected", feedback: "Rejected from workbench." } : { action: "approved" };
  if (reject) return "Rejected";
  const options = payload && typeof payload === "object" && "options" in payload ? (payload as { options?: unknown }).options : undefined;
  return Array.isArray(options) ? options.find((value): value is string => typeof value === "string") ?? "Approved" : "Approved";
}

function shortId(value: string) { return value.length <= 12 ? value : `${value.slice(0, 8)}...`; }
