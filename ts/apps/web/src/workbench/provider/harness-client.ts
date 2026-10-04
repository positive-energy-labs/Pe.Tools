/**
 * The harness-thread wire, typed (`@pe/agent-contracts` harness-thread.ts lists every route). The
 * web never talks to a harness: it reads the host's event log and posts the user's verbs.
 */
import type {
  HarnessEvent,
  HarnessId,
  HarnessInfo,
  HarnessThreadBody,
  HarnessThreadSummary,
} from "@pe/agent-contracts";
import { openEventSource } from "#/readings";

export function harnessClient(origin: string) {
  const call = async <T>(path: string, method = "GET", body?: object, signal?: AbortSignal) => {
    const response = await fetch(`${origin}/pe${path}`, {
      method,
      signal,
      // The host refuses a bodiless non-GET without the json content type (415).
      ...(method === "GET" ? {} : { headers: { "content-type": "application/json" } }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const said = await response.text().catch(() => "");
      throw Object.assign(new Error(said || `${method} /pe${path} failed (${response.status}).`), {
        status: response.status,
      });
    }
    return (
      response.status === 204 ? undefined : await response.json().catch(() => undefined)
    ) as T;
  };
  const thread = (id: string) => `/threads/${encodeURIComponent(id)}`;
  return {
    harnesses: () => call<HarnessInfo[]>("/harnesses"),
    threads: () => call<HarnessThreadSummary[]>("/threads"),
    create: (harness: HarnessId) => call<HarnessThreadSummary>("/threads", "POST", { harness }),
    body: (id: string, signal?: AbortSignal) =>
      call<HarnessThreadBody>(thread(id), "GET", undefined, signal),
    rename: (id: string, title: string) => call<HarnessThreadSummary>(thread(id), "PUT", { title }),
    remove: (id: string) => call<void>(thread(id), "DELETE"),
    prompt: (id: string, text: string) =>
      call<{ turnId: string }>(`${thread(id)}/prompt`, "POST", { text }),
    cancel: (id: string) => call<void>(`${thread(id)}/cancel`, "POST"),
    permission: (id: string, requestId: string, optionId: string) =>
      call<void>(`${thread(id)}/permission`, "POST", { requestId, optionId }),
    model: (id: string, modelId: string) => call<void>(`${thread(id)}/model`, "POST", { modelId }),
    mode: (id: string, modeId: string) => call<void>(`${thread(id)}/mode`, "POST", { modeId }),
  };
}

/** The host answered 404: the thread (or route) does not exist there. */
export const notFound = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;

/** The browser's EventSource, or a test's stand-in with the same three members. */
export type OpenEvents = (url: string) => Pick<EventSource, "onmessage" | "onerror" | "close">;

/**
 * Tail one thread's log from `after`. On any stream error it closes and reopens from the last
 * seq it delivered, so a reconnect never replays or skips; a stale or repeated seq is dropped.
 */
export function streamThread(options: {
  origin: string;
  threadId: string;
  after: number;
  onEvent: (event: HarnessEvent) => void;
  onFault?: (error: Error) => void;
  open?: OpenEvents;
  retryMs?: number;
}): () => void {
  const { origin, threadId, onEvent, onFault, retryMs = 1_000 } = options;
  const open = options.open ?? openEventSource;
  let last = options.after;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: ReturnType<OpenEvents> | undefined;
  const connect = () => {
    const events = open(
      `${origin}/pe/threads/${encodeURIComponent(threadId)}/stream?after=${last}`,
    );
    source = events;
    events.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as HarnessEvent;
      if (event.seq <= last) return;
      last = event.seq;
      onEvent(event);
    };
    events.onerror = () => {
      events.close();
      if (stopped) return;
      onFault?.(new Error("Thread stream dropped; reconnecting."));
      timer = setTimeout(connect, retryMs);
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}
