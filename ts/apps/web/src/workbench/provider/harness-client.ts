import { createPeClient } from "@pe/agent-contracts/pe-api";
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
  UpdateThreadRequest,
  PutTarget,
  TurnElementNamesRequest,
} from "@pe/agent-contracts";
import { harnessThreadSummarySchema } from "@pe/agent-contracts";
import { followThread } from "@pe/agent-contracts/chat-state";
import { fromStandardSchema } from "@pe/host-contracts/contracts";
import { Cause, Exit, Schema } from "effect";
import type { z } from "zod";
import { peReadings, type Readings } from "#/host/resource-stream";

/** What a send posts: text, attachments, mentions (`promptRequestSchema`); the client mints its id. */
export type PromptRequest = Omit<z.input<typeof promptRequestSchema>, "id">;

/** The thread list's snapshot value, decoded (ADR 0029 rule 7). */
const ThreadSummaries = Schema.Array(
  fromStandardSchema(harnessThreadSummarySchema, "HarnessThreadSummary"),
);

export function harnessClient(origin: string) {
  const client = createPeClient(origin, hostFetch);
  return {
    providers: () => client.call("providers.list", {}),
    addProvider: (body: AddProviderRequest) => client.call("providers.add", { body }),
    removeProvider: (id: string) => client.call("provider.remove", { params: { id } }),
    probe: (id: string) => client.call("provider.probe", { params: { id } }),
    openLogin: (id: string) => client.call("provider.login", { params: { id } }),
    threads: () => client.call("threads.list", {}),
    create: (providerId: string) => client.call("threads.create", { body: { providerId } }),
    body: (id: string, signal?: AbortSignal) =>
      client.call("thread.get", { params: { id } }, { signal }),
    rename: (id: string, title: string) =>
      client.call("thread.update", { params: { id }, body: { title } }),
    update: (id: string, body: UpdateThreadRequest) =>
      client.call("thread.update", { params: { id }, body }),
    summaries: (
      onChange: (threads: readonly HarnessThreadSummary[]) => void,
      onFault: (error: Error) => void,
    ) => {
      // The one Readings owner carries the list: its fault, backoff, wake and resync are this
      // list's, so a stalled tab converges instead of painting an old roster as live.
      let seen = false;
      return peReadings.subscribe({ kind: "threads" }, (frame) => {
        if (frame.kind === "snapshot") {
          // React caller until phase 5: a list that does not decode is a fault, never painted.
          const summaries = Schema.decodeUnknownExit(ThreadSummaries)(frame.value);
          if (Exit.isFailure(summaries))
            return onFault(
              new Error(`Thread list does not decode: ${Cause.pretty(summaries.cause)}`),
            );
          seen = true;
          onChange(summaries.value);
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

/**
 * Follow one thread's `thread` Reading on the tab's one stream, from the body's `cursor`, applying
 * events past `lastSeq` by the shared rule (`followThread`). The cursor rides the key: when the
 * stream is fenced or reconnects, the follow subscribes again after the last host log id it saw,
 * so a reconnect neither replays nor skips. A gap or a hole in seq ends this follow with
 * `onReread`: read the body again and follow from its cursor. A dropped connection is the Readings
 * owner's fault to report (`onResync`), not this follower's.
 */
export function streamThread(options: {
  threadId: string;
  cursor: number;
  lastSeq: number;
  onEvent: (event: HarnessEvent) => void;
  onReread: () => void;
  onFault?: (error: Error) => void;
  readings?: Pick<Readings, "subscribe">;
}): () => void {
  const { threadId, onEvent, onReread, onFault, readings = peReadings } = options;
  let cursor = options.cursor;
  let last = options.lastSeq;
  let stopped = false;
  let subscribed = cursor;
  let release = () => {};
  const stop = () => {
    stopped = true;
    release();
  };
  const follow = () => {
    release();
    subscribed = cursor;
    release = readings.subscribe({ kind: "thread", thread: threadId, after: cursor }, (frame) => {
      if (stopped) return;
      if (frame.kind === "stale") {
        // Fenced or reconnecting: resume after what was applied, not from the first cursor.
        if (cursor !== subscribed) follow();
        return;
      }
      // SHIM: S gap 6 queues event tails behind mark capture. Remove this failure-body reread
      // and its backlog test once the kernel bypasses that queue and exposes stream failures.
      if (frame.kind === "failure") {
        stop();
        onFault?.(new Error(frame.error));
        onReread();
        return;
      }
      if (frame.kind === "snapshot") return;
      if (frame.id !== undefined) cursor = frame.id;
      const step = followThread(last, frame);
      if (step.kind === "apply") {
        last = step.event.seq;
        onEvent(step.event);
      } else if (step.kind === "reread") {
        stop();
        onReread();
      }
    });
    // A listener may stop the follow before `subscribe` returns its release.
    if (stopped) release();
  };
  follow();
  return stop;
}
