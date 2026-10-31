import { createPeClient, peRouteUrl } from "@pe/agent-contracts/pe-api";
import { hostFetch } from "#/host/runtime";
/**
 * The harness-thread wire, typed (`@pe/agent-contracts` harness-thread.ts lists every route). The
 * web never talks to a harness: it reads the host's event log and posts the user's verbs.
 */
import type {
  AddProviderRequest,
  HarnessEvent,
  HarnessThreadSummary,
  promptRequestSchema,
  ReadingFrame,
  ReadingRequest,
  UpdateThreadRequest,
  PutTarget,
  TurnElementNamesRequest,
} from "@pe/agent-contracts";
import { followThread } from "@pe/agent-contracts/chat-state";
import type { z } from "zod";
import { openEventSource, peReadings } from "#/readings";

/** What a send posts: text, attachments, mentions (`promptRequestSchema`); the client mints its id. */
export type PromptRequest = Omit<z.input<typeof promptRequestSchema>, "id">;

export function harnessClient(origin: string) {
  const client = createPeClient(origin, hostFetch);
  return {
    providers: () => client.call("providers.list", {}),
    addProvider: (body: AddProviderRequest) => client.call("providers.add", { body }),
    removeProvider: (id: string) => client.call("provider.remove", { params: { id } }),
    probe: (id: string) => client.call("provider.probe", { params: { id } }),
    openLogin: (id: string) => client.call("provider.login", { params: { id } }),
    setAccess: (guarded: boolean) => client.call("access.set", { body: { guarded } }),
    threads: () => client.call("threads.list", {}),
    create: (providerId: string) => client.call("threads.create", { body: { providerId } }),
    body: (id: string, signal?: AbortSignal) =>
      client.call("thread.get", { params: { id } }, { signal }),
    rename: (id: string, title: string) =>
      client.call("thread.update", { params: { id }, body: { title } }),
    update: (id: string, body: UpdateThreadRequest) =>
      client.call("thread.update", { params: { id }, body }),
    summaries: (
      onChange: (threads: HarnessThreadSummary[]) => void,
      onFault: (error: Error) => void,
    ) => {
      // The one Readings owner carries the list: its fault, backoff, wake and resync are this
      // list's, so a stalled tab converges instead of painting an old roster as live.
      let seen = false;
      return peReadings.subscribe({ kind: "threads" }, (frame) => {
        if (frame.kind === "snapshot") {
          seen = true;
          onChange(frame.value as HarnessThreadSummary[]);
        } else if (frame.kind === "stale" && seen)
          onFault(new Error("Thread list is not current; reconnecting."));
      });
    },
    target: (id: string, body: PutTarget) => client.call("scope.set", { params: { id }, body }),
    remove: (id: string) => client.call("thread.remove", { params: { id } }),
    prompt: (id: string, body: PromptRequest) =>
      client.call("thread.prompt", { params: { id }, body: { id: crypto.randomUUID(), ...body } }),
    cancel: (id: string) => client.call("thread.cancel", { params: { id } }),
    permission: (id: string, requestId: string, optionId: string) =>
      client.call("thread.permission", { params: { id }, body: { requestId, optionId } }),
    question: (
      id: string,
      requestId: string,
      action: "accept" | "decline",
      content?: Record<string, unknown>,
    ) => client.call("thread.question", { params: { id }, body: { requestId, action, content } }),
    fork: (id: string, providerId?: string) =>
      client.call("thread.fork", { params: { id }, body: { providerId } }),
    model: (id: string, modelId: string) =>
      client.call("thread.model", { params: { id }, body: { modelId } }),
    trait: (id: string, traitId: string, value: string | boolean) =>
      client.call("thread.trait", { params: { id }, body: { id: traitId, value } }),
    /** One batch per settled turn; the host pins the documents, the web sends only ids. */
    turnElementNames: (body: TurnElementNamesRequest) =>
      client.call("turn.element-names", { body }),
  };
}

/** The host answered 404: the thread (or route) does not exist there. */
export const notFound = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;

/** The browser's EventSource, or a test's stand-in with the same three members. */
export type OpenEvents = (url: string) => Pick<EventSource, "onmessage" | "onerror" | "close">;

/** One Readings connection (`resources.stream`) for one key, resumed after a host log cursor. */
export const readingsUrl = (origin: string, key: ReadingRequest, after?: number) =>
  peRouteUrl(
    "resources.stream",
    {
      query: {
        keys: JSON.stringify([key]),
        ...(after === undefined ? {} : { after: String(after) }),
      },
    },
    origin,
  );

/**
 * Follow one thread's `thread` Reading from the body's `cursor`, applying events past `lastSeq` by
 * the shared rule (`followThread`). A dropped stream reopens after the last host log id it saw, so
 * a reconnect neither replays nor skips. A gap or a hole in seq ends this stream with `onReread`:
 * read the body again and follow from its cursor.
 */
export function streamThread(options: {
  origin: string;
  threadId: string;
  cursor: number;
  lastSeq: number;
  onEvent: (event: HarnessEvent) => void;
  onReread: () => void;
  onFault?: (error: Error) => void;
  open?: OpenEvents;
  retryMs?: number;
}): () => void {
  const { origin, threadId, onEvent, onReread, onFault, retryMs = 1_000 } = options;
  const open = options.open ?? openEventSource;
  let cursor = options.cursor;
  let last = options.lastSeq;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: ReturnType<OpenEvents> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
  const connect = () => {
    const events = open(readingsUrl(origin, { kind: "thread", thread: threadId }, cursor));
    source = events;
    events.onmessage = (message: MessageEvent<string>) => {
      if (message.lastEventId) cursor = Number(message.lastEventId);
      const step = followThread(last, JSON.parse(message.data) as ReadingFrame);
      if (step.kind === "apply") {
        last = step.event.seq;
        onEvent(step.event);
      } else if (step.kind === "reread") {
        stop();
        onReread();
      }
    };
    events.onerror = () => {
      events.close();
      if (stopped) return;
      onFault?.(new Error("Thread stream dropped; reconnecting."));
      timer = setTimeout(connect, retryMs);
    };
  };
  connect();
  return stop;
}
