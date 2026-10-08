/**
 * The harness-thread wire, typed (`@pe/agent-contracts` harness-thread.ts lists every route). The
 * web never talks to a harness: it reads the host's event log and posts the user's verbs.
 */
import type {
  Access,
  AddProviderRequest,
  HarnessEvent,
  HarnessThreadBody,
  HarnessThreadSummary,
  Provider,
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
      throw Object.assign(
        new Error(
          said(await response.text().catch(() => "")) ||
            `${method} /pe${path} failed (${response.status}).`,
        ),
        {
          status: response.status,
        },
      );
    }
    return (
      response.status === 204 ? undefined : await response.json().catch(() => undefined)
    ) as T;
  };
  const thread = (id: string) => `/threads/${encodeURIComponent(id)}`;
  const provider = (id: string) => `/providers/${encodeURIComponent(id)}`;
  return {
    providers: () => call<Provider[]>("/providers"),
    addProvider: (input: AddProviderRequest) => call<Provider>("/providers", "POST", input),
    removeProvider: (id: string) => call<void>(provider(id), "DELETE"),
    probe: (id: string) => call<Provider>(`${provider(id)}/probe`, "POST"),
    openLogin: (id: string) => call<{ opened: true }>(`${provider(id)}/open-login`, "POST"),
    access: () => call<Access>("/access"),
    setAccess: (access: Access) => call<Access>("/access", "PUT", access),
    threads: () => call<HarnessThreadSummary[]>("/threads"),
    create: (providerId: string) => call<HarnessThreadSummary>("/threads", "POST", { providerId }),
    body: (id: string, signal?: AbortSignal) =>
      call<HarnessThreadBody>(thread(id), "GET", undefined, signal),
    rename: (id: string, title: string) => call<HarnessThreadSummary>(thread(id), "PUT", { title }),
    remove: (id: string) => call<void>(thread(id), "DELETE"),
    prompt: (id: string, text: string) =>
      call<{ turnId: string }>(`${thread(id)}/prompt`, "POST", { text }),
    cancel: (id: string) => call<void>(`${thread(id)}/cancel`, "POST"),
    permission: (id: string, requestId: string, optionId: string) =>
      call<void>(`${thread(id)}/permission`, "POST", { requestId, optionId }),
    question: (
      id: string,
      requestId: string,
      action: "accept" | "decline",
      content?: Record<string, unknown>,
    ) => call<void>(`${thread(id)}/question`, "POST", { requestId, action, content }),
    /** Same provider forks the ACP session; another provider re-feeds the transcript. */
    fork: (id: string, providerId?: string) =>
      call<HarnessThreadSummary>(`${thread(id)}/fork`, "POST", providerId ? { providerId } : {}),
    model: (id: string, modelId: string) => call<void>(`${thread(id)}/model`, "POST", { modelId }),
    trait: (id: string, traitId: string, value: string | boolean) =>
      call<void>(`${thread(id)}/trait`, "POST", { id: traitId, value }),
  };
}

/** A refusal body as words: `{step, message}` (a provider add) or `{error}`; otherwise the text. */
function said(text: string): string {
  try {
    const body = JSON.parse(text) as { step?: string; message?: string; error?: string };
    return body.step ? `${body.step}: ${body.message}` : (body.message ?? body.error ?? text);
  } catch {
    return text;
  }
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
