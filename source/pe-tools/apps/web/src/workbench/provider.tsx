import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MastraClient, type AgentControllerThreadInfo } from "@mastra/client-js";
import { z } from "zod";
import {
  createWorkbenchState,
  selectPendingApprovals,
  type WorkbenchAccessLevel,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { peUrl, resolveWorkbenchConfig, type WorkbenchEndpointConfig } from "./config";
import { applyWireEvent, hydrateWorkbenchState, type PeInspect } from "./adapter";
import { parseWireEvent, parseWireMessages, type WireMessageContent } from "./wire";
import { useThreadClaim } from "./claims";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  persisted: boolean;
  promptActive?: boolean;
  cwd?: string;
}

/** Composer attachment: text files carry `text`, binary/image carry base64 `data`. */
export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

/** Resume payload for an interactive tool suspension (string for ask_user, PlanResume for submit_plan). */
type ToolResume = string | { action: "approved" | "rejected"; feedback?: string };

/** The session client type, derived from the SDK (its class type isn't re-exported at the root). */
type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;

/** Connection handshake — which controller/session the native routes drive. */
const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });
type PeInfo = z.infer<typeof peInfoSchema>;

interface WorkbenchContextValue {
  config: WorkbenchEndpointConfig;
  debug: { state: WorkbenchState; loading: boolean; error?: string };
  threads: StoredThreadSummary[];
  /** Derived from the URL `thread` search param — the single source of truth for "which thread". */
  currentThreadId: string;
  isRunning: boolean;
  operation?: string;
  operationError?: string;
  /** Another tab owns this thread - composing/sending is disabled here until takeover. */
  readOnly: boolean;
  takeOverThread: () => void;
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  switchThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAccessLevel: (accessLevel: WorkbenchAccessLevel) => Promise<void>;
  forkThread: (messageId?: string) => Promise<void>;
  refreshProjection: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/chat" });
  // URL is canonical for which thread is open. Everything below is server-derived cache.
  const { thread } = useSearch({ from: "/chat" });
  const currentThreadId = thread ?? "";

  const [info, setInfo] = useState<PeInfo>();
  const [state, setState] = useState<WorkbenchState>(() => createWorkbenchState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const initedRef = useRef(false);
  const claim = useThreadClaim(currentThreadId || "draft");

  // The native session + controller clients. `baseUrl` is the workbench origin; the SDK's default
  // apiPrefix (`/api`) matches where Pe mounts the @mastra/server routes.
  const api = useMemo(() => {
    if (!info) return undefined;
    const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
      info.controllerId,
    );
    return { controller, session: controller.session(info.resourceId) };
  }, [config.origin, info]);

  const isRunning =
    state.uiStatus.overall.status === "running" || state.uiStatus.overall.status === "waiting";

  // Refs the persistent stream handler closes over without re-subscribing.
  const currentThreadIdRef = useRef(currentThreadId);
  currentThreadIdRef.current = currentThreadId;

  /** Replace the URL thread param (no history spam on auto-landing / switching). */
  const gotoThread = useCallback(
    (threadId: string, replace = false) => {
      void navigate({ search: (prev) => ({ ...prev, thread: threadId }), replace });
    },
    [navigate],
  );

  const refreshThreads = useCallback(async () => {
    if (!api) return;
    try {
      setThreads(toSummaries(await api.session.listThreads()));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [api]);

  /** Fetch every snapshot for a thread and project the initial WorkbenchState. */
  const hydrate = useCallback(
    async (threadId: string, options?: { silent?: boolean }) => {
      if (!api || !info) return;
      if (!options?.silent) setLoading(true);
      try {
        // Align the session's active thread to the URL so state + the stream track it.
        await api.session.switchThread(threadId).catch(() => undefined);
        const [display, messages, inspect, models, modes] = await Promise.all([
          api.session.state().catch(() => undefined),
          api.session
            .listMessages(threadId)
            .then(parseWireMessages)
            .catch(() => []),
          fetchPeInspect(config).catch(() => ({}) as PeInspect),
          api.controller.listModels().catch(() => []),
          api.controller.listModes().catch(() => []),
        ]);
        setState(
          hydrateWorkbenchState({
            controllerId: info.controllerId,
            resourceId: info.resourceId,
            threadId,
            displayState: display,
            threads: threadsRef.current,
            messages,
            inspect,
            models,
            modes,
          }),
        );
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [api, info, config],
  );

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const hydrateRef = useRef(hydrate);
  hydrateRef.current = hydrate;
  const refreshThreadsRef = useRef(refreshThreads);
  refreshThreadsRef.current = refreshThreads;

  /** Create a thread server-side and return its id. URL navigation is the caller's job. */
  const createThread = useCallback(async (): Promise<string> => {
    if (!api) throw new Error("Not connected to the workbench yet.");
    const thread = await api.session.createThread();
    await refreshThreads();
    return thread.id;
  }, [api, refreshThreads]);

  // Connection handshake: learn the controller/resource the native routes drive.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = peInfoSchema.parse(await getJson(peUrl(config, "/info")));
        if (!cancelled) setInfo(next);
      } catch (caught) {
        if (!cancelled) {
          setLoading(false);
          setError(errorMessage(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  // One persistent SSE subscription per session. It survives thread switches; the handler reduces
  // every validated event into WorkbenchState and refreshes the thread list on lifecycle events.
  // agent_end re-hydrates the canonical transcript silently.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void api.session
      .subscribe({
        onEvent: (raw) => {
          const event = parseWireEvent(raw);
          if (!event) return; // unmodeled event type — dropped at the boundary
          setState((previous) => applyWireEvent(previous, event));
          if (
            event.type === "thread_created" ||
            event.type === "thread_deleted" ||
            event.type === "thread_changed"
          ) {
            void refreshThreadsRef.current();
          }
          if (event.type === "agent_end" && currentThreadIdRef.current) {
            void hydrateRef.current(currentThreadIdRef.current, { silent: true });
          }
        },
        // The SDK stream ended/erred; the next hydrate re-syncs state. No manual reconnect.
        onError: () => {},
      })
      .then((subscription) => {
        if (cancelled) subscription.unsubscribe();
        else unsubscribe = subscription.unsubscribe;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  // Load the thread list once connected — the picker needs it even on a deep link.
  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // React to the URL thread param: hydrate whenever it points at a thread.
  useEffect(() => {
    if (!api || !currentThreadId) return;
    setState(createWorkbenchState());
    void hydrate(currentThreadId);
  }, [api, currentThreadId, hydrate]);

  // First landing with no ?thread=: pick the latest existing thread or create one, then write it
  // into the URL (replace) so the hydrate effect above takes over.
  useEffect(() => {
    if (!api || currentThreadId || initedRef.current) return;
    initedRef.current = true;
    void (async () => {
      try {
        const list = toSummaries(await api.session.listThreads());
        setThreads(list);
        gotoThread(list[0] ? list[0].id : await createThread(), true);
      } catch (caught) {
        initedRef.current = false; // allow a retry on transient failure
        setLoading(false);
        setError(errorMessage(caught));
      }
    })();
  }, [api, currentThreadId, gotoThread, createThread]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      // An image-only send (empty text) is valid — guard on "nothing to send", not "no text".
      if ((!prompt && !attachments?.length) || !api) return;
      if (currentThreadId && !claim.isOwner) {
        setError("This thread is open in another tab - take over to send here.");
        return;
      }

      let threadId = currentThreadId;
      if (!threadId) {
        threadId = await createThread();
        gotoThread(threadId, true);
        await api.session.switchThread(threadId).catch(() => undefined);
      }
      // Optimistically show the user's turn (text + any attached images) + running state; the
      // stream confirms via agent_start. Images render from the in-hand base64, no server echo needed.
      const optimisticContent: WireMessageContent[] = [
        ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
        ...attachmentsToContent(attachments),
      ];
      setState((previous) => ({
        ...applyWireEvent(previous, {
          type: "message_start",
          message: {
            id: `local-user-${Date.now()}`,
            role: "user",
            content: optimisticContent,
          },
        }),
        uiStatus: {
          ...previous.uiStatus,
          overall: { ...previous.uiStatus.overall, status: "running" },
        },
      }));
      setError(undefined);
      try {
        // Pe send route carries attachments the native `{ message }` route can't.
        await postPeMessage(config, prompt, toFiles(attachments));
      } catch (caught) {
        setError(errorMessage(caught));
        setState((previous) => applyWireEvent(previous, { type: "agent_end" }));
      }
    },
    [config, api, currentThreadId, createThread, gotoThread, claim.isOwner],
  );

  const cancel = useCallback(() => {
    if (!api) return;
    for (const approval of selectPendingApprovals(stateRef.current)) {
      void rejectApproval(api.session, approval.requestId).catch(() => undefined);
    }
    void api.session.abort().catch(() => undefined);
    setState((previous) => applyWireEvent(previous, { type: "agent_end" }));
  }, [api]);

  const newThread = useCallback(() => {
    setLoading(true);
    void createThread()
      .then((id) => gotoThread(id))
      .catch((caught) => {
        setLoading(false);
        setError(errorMessage(caught));
      });
  }, [createThread, gotoThread]);

  const switchThread = useCallback(
    (threadId: string) => {
      gotoThread(threadId); // hydrate effect reacts to the URL change
    },
    [gotoThread],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!api) return;
      try {
        await api.session.deleteThread(threadId);
      } catch (caught) {
        setError(errorMessage(caught));
      }
      if (threadId === currentThreadId) newThread();
      await refreshThreads();
    },
    [api, currentThreadId, newThread, refreshThreads],
  );

  const resolveApproval = useCallback(
    async (requestId: string, optionId?: string) => {
      if (!api) return;
      const reject = optionId?.startsWith("reject") ?? false;
      // Optimistically resolve so the inline buttons disappear; the stream confirms via tool_end.
      setState((previous) => ({
        ...previous,
        approvals: {
          requests: previous.approvals.requests.map((request) =>
            request.requestId === requestId
              ? { ...request, status: "resolved", selectedOptionId: optionId }
              : request,
          ),
        },
      }));
      try {
        if (requestId.startsWith("tool-suspended:")) {
          const toolCallId = requestId.slice("tool-suspended:".length);
          const request = stateRef.current.approvals.requests.find(
            (item) => item.requestId === requestId,
          );
          await api.session.respondToToolSuspension(
            toolCallId,
            resumeDataForSuspension(request?.toolCall.title, request?.toolCall.rawOutput, reject),
          );
        } else {
          const toolCallId = requestId.startsWith("tool-approval:")
            ? requestId.slice("tool-approval:".length)
            : requestId;
          await api.session.approveTool(toolCallId, !reject);
        }
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!api) return;
      try {
        await api.session.switchModel(modelId);
        setState((previous) => ({
          ...previous,
          models: { ...previous.models, currentModelId: modelId },
        }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const setAccessLevel = useCallback(
    async (accessLevel: WorkbenchAccessLevel) => {
      if (!api) return;
      try {
        await api.session.setState({ yolo: accessLevel === "trusted", accessLevel });
        setState((previous) => ({
          ...previous,
          access: { ...previous.access, currentAccessLevel: accessLevel },
        }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const forkThread = useCallback(
    async (messageId?: string) => {
      if (!api || !currentThreadId) return;
      // Native clone forks the whole thread — no per-message cutoff. The `messageId` from "fork
      // from this turn" is accepted but ignored; see MASTRA_UPSTREAM_CANDIDATES.md.
      void messageId;
      try {
        const clone = await api.session.cloneThread({ sourceThreadId: currentThreadId });
        await refreshThreads();
        switchThread(clone.id);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api, currentThreadId, refreshThreads, switchThread],
  );

  const refreshProjection = useCallback(() => {
    void refreshThreads();
    if (currentThreadId) void hydrate(currentThreadId);
  }, [currentThreadId, hydrate, refreshThreads]);

  const operationError = error ?? state.uiStatus.errors[0];
  const context = useMemo<WorkbenchContextValue>(
    () => ({
      config,
      debug: { state, loading, error },
      threads,
      currentThreadId,
      isRunning,
      operationError,
      readOnly: Boolean(currentThreadId) && !claim.isOwner,
      takeOverThread: claim.takeOver,
      sendPrompt,
      cancel,
      newThread,
      switchThread,
      deleteThread,
      resolveApproval,
      setModel,
      setAccessLevel,
      forkThread,
      refreshProjection,
    }),
    [
      config,
      state,
      loading,
      error,
      operationError,
      threads,
      currentThreadId,
      isRunning,
      claim.isOwner,
      claim.takeOver,
      sendPrompt,
      cancel,
      newThread,
      switchThread,
      deleteThread,
      resolveApproval,
      setModel,
      setAccessLevel,
      forkThread,
      refreshProjection,
    ],
  );

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

/** submit_plan / ask_user suspensions answer with a tool-specific resume payload. */
function resumeDataForSuspension(
  toolName: string | undefined,
  suspendPayload: unknown,
  reject: boolean,
): ToolResume {
  if (toolName === "submit_plan") {
    return reject
      ? { action: "rejected", feedback: "Rejected from workbench." }
      : { action: "approved" };
  }
  if (reject) return "Rejected";
  const options = readArray(readRecord(suspendPayload)?.options);
  const first = options?.map((option) => readString(option)).find(Boolean);
  return first ?? "Approved";
}

async function rejectApproval(session: SessionClient, requestId: string): Promise<void> {
  if (requestId.startsWith("tool-suspended:")) {
    await session.respondToToolSuspension(requestId.slice("tool-suspended:".length), "Rejected");
    return;
  }
  await session.approveTool(
    requestId.startsWith("tool-approval:") ? requestId.slice("tool-approval:".length) : requestId,
    false,
  );
}

/** Composer attachments → optimistic wire content. Binary (images) carry base64 `data`; everything
 * else shows as a filename chip. Mirrors the `messagePart` image/file branch in adapter.ts. */
function attachmentsToContent(
  attachments: WorkbenchAttachment[] | undefined,
): WireMessageContent[] {
  if (!attachments?.length) return [];
  return attachments.map((attachment) =>
    attachment.data
      ? {
          type: "image" as const,
          data: attachment.data,
          mimeType: attachment.mimeType,
          filename: attachment.name,
        }
      : { type: "text" as const, text: `📎 ${attachment.name ?? "attachment"}` },
  );
}

/** Map composer attachments to the `files` shape `Session.sendMessage` (via /pe/messages) takes. */
function toFiles(
  attachments: WorkbenchAttachment[] | undefined,
): Array<{ data: string; mediaType: string; filename?: string }> | undefined {
  if (!attachments?.length) return undefined;
  const files = attachments.flatMap((attachment) => {
    if (attachment.data) {
      return [
        {
          data: attachment.data,
          mediaType: attachment.mimeType ?? "application/octet-stream",
          ...(attachment.name ? { filename: attachment.name } : {}),
        },
      ];
    }
    if (attachment.text !== undefined) {
      return [
        {
          data: toBase64(attachment.text),
          mediaType: attachment.mimeType ?? "text/plain",
          ...(attachment.name ? { filename: attachment.name } : {}),
        },
      ];
    }
    return [];
  });
  return files.length ? files : undefined;
}

// ponytail: fine for text attachments; chunk the byte loop if multi-MB text ever needs base64ing.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toSummaries(threads: AgentControllerThreadInfo[]): StoredThreadSummary[] {
  return threads
    .map((thread) => ({
      id: thread.id,
      title: thread.title ?? shortId(thread.id),
      updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
      messageCount: 0,
      persisted: true,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchPeInspect(config: WorkbenchEndpointConfig): Promise<PeInspect> {
  const response = await fetch(peUrl(config, "/inspect"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};
  return (await response.json().catch(() => ({}))) as PeInspect;
}

async function postPeMessage(
  config: WorkbenchEndpointConfig,
  message: string,
  files: Array<{ data: string; mediaType: string; filename?: string }> | undefined,
): Promise<void> {
  const response = await fetch(peUrl(config, "/messages"), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(files ? { message, files } : { message }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
