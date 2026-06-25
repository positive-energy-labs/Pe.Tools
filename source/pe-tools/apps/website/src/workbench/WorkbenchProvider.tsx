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
import {
  createWorkbenchState,
  isWorkbenchState,
  selectPendingApprovals,
  type WorkbenchAccessLevel,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { resolveWorkbenchConfig, workbenchUrl, type WorkbenchEndpointConfig } from "./config.ts";
import { useThreadClaim } from "./claims.ts";

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

interface WorkbenchContextValue {
  config: WorkbenchEndpointConfig;
  debug: { state: WorkbenchState; loading: boolean; error?: string };
  threads: StoredThreadSummary[];
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
  switchThread: (threadId: string) => Promise<void>;
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
  const [state, setState] = useState<WorkbenchState>(() => createWorkbenchState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const initedRef = useRef(false);
  const claim = useThreadClaim(currentThreadId || "draft");

  const applyStatePayload = useCallback((payload: unknown): WorkbenchState | undefined => {
    const next = readState(payload);
    if (!next) return undefined;
    setState(next);
    setIsRunning(
      next.uiStatus.overall.status === "running" || next.uiStatus.overall.status === "waiting",
    );
    setError(next.uiStatus.errors[0]);
    return next;
  }, []);

  const refreshThreads = useCallback(async () => {
    try {
      const payload = await fetchJson(workbenchUrl(config, "/workbench/threads"));
      setThreads(toSummaries(readArray(readRecord(payload)?.threads) ?? []));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [config]);

  const hydrate = useCallback(
    async (threadId: string) => {
      try {
        const payload = await fetchJson(workbenchUrl(config, "/workbench/state", { threadId }));
        // The server can answer 200 with `{ error }` and no `state` (e.g. a thread it can't
        // open). applyStatePayload returns undefined then — surface the error instead of
        // silently rendering nothing.
        if (!applyStatePayload(payload)) {
          setError(readString(readRecord(payload)?.error) ?? "Could not open this thread.");
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [config, applyStatePayload],
  );

  const createThread = useCallback(async (): Promise<string> => {
    const payload = await postJson(workbenchUrl(config, "/workbench/threads"), {});
    const threadId = readString(readRecord(payload)?.threadId);
    if (!threadId) throw new Error("Workbench server did not return a thread id.");
    setCurrentThreadId(threadId);
    applyStatePayload(payload);
    setLoading(false);
    await refreshThreads();
    return threadId;
  }, [config, applyStatePayload, refreshThreads]);

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchJson(workbenchUrl(config, "/workbench/threads"));
        if (cancelled) return;
        const list = toSummaries(readArray(readRecord(payload)?.threads) ?? []);
        setThreads(list);
        const latest = list[0];
        if (latest) {
          setCurrentThreadId(latest.id);
          await hydrate(latest.id);
        } else {
          await createThread();
        }
      } catch (caught) {
        if (cancelled) return;
        setLoading(false);
        setError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, hydrate, createThread]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      if ((!prompt && !attachments?.length) || abortRef.current) return;
      if (currentThreadId && !claim.isOwner) {
        setError("This thread is open in another tab - take over to send here.");
        return;
      }

      const threadId = currentThreadId || (await createThread());
      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setError(undefined);
      try {
        await streamWorkbenchRun(
          workbenchUrl(config, "/workbench/run"),
          {
            threadId,
            text: prompt,
            clientId: claim.tabId,
            ...(attachments?.length ? { attachments } : {}),
          },
          controller.signal,
          (payload) => {
            const next = applyStatePayload(payload);
            const message = readString(readRecord(payload)?.error);
            if (!next && message) setError(message);
          },
        );
        if (!controller.signal.aborted) void refreshThreads();
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsRunning(false);
      }
    },
    [
      config,
      currentThreadId,
      createThread,
      refreshThreads,
      claim.isOwner,
      claim.tabId,
      applyStatePayload,
    ],
  );

  const cancel = useCallback(() => {
    for (const approval of selectPendingApprovals(stateRef.current)) {
      void postJson(workbenchUrl(config, "/workbench/approve"), {
        threadId: currentThreadId,
        requestId: approval.requestId,
        optionId: "reject_once",
      }).catch(() => undefined);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, [config, currentThreadId]);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(true);
    setIsRunning(false);
    void createThread().catch((caught) => {
      setLoading(false);
      setError(errorMessage(caught));
    });
  }, [createThread]);

  const switchThread = useCallback(
    async (threadId: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRunning(false);
      setCurrentThreadId(threadId);
      setState(createWorkbenchState());
      setLoading(true);
      await hydrate(threadId);
    },
    [hydrate],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      try {
        await fetch(workbenchUrl(config, `/workbench/threads/${encodeURIComponent(threadId)}`), {
          method: "DELETE",
          headers: { Accept: "application/json" },
        });
      } catch (caught) {
        setError(errorMessage(caught));
      }
      if (threadId === currentThreadId) newThread();
      await refreshThreads();
    },
    [config, currentThreadId, newThread, refreshThreads],
  );

  const resolveApproval = useCallback(
    async (requestId: string, optionId?: string) => {
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
        applyStatePayload(
          await postJson(workbenchUrl(config, "/workbench/approve"), {
            threadId: currentThreadId,
            requestId,
            ...(optionId ? { optionId } : {}),
          }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config, currentThreadId, applyStatePayload],
  );

  const setModel = useCallback(
    async (modelId: string) => {
      try {
        applyStatePayload(
          await postJson(workbenchUrl(config, "/workbench/model"), {
            threadId: currentThreadId,
            modelId,
          }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config, currentThreadId, applyStatePayload],
  );

  const setAccessLevel = useCallback(
    async (accessLevel: WorkbenchAccessLevel) => {
      try {
        applyStatePayload(
          await postJson(workbenchUrl(config, "/workbench/access"), {
            threadId: currentThreadId,
            accessLevel,
          }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config, currentThreadId, applyStatePayload],
  );

  const forkThread = useCallback(
    async (messageId?: string) => {
      try {
        const payload = await postJson(workbenchUrl(config, "/workbench/fork"), {
          threadId: currentThreadId,
          ...(messageId ? { messageId } : {}),
        });
        const newThreadId = readString(readRecord(payload)?.threadId);
        if (newThreadId) {
          await refreshThreads();
          await switchThread(newThreadId);
        }
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config, currentThreadId, refreshThreads, switchThread],
  );

  const refreshProjection = useCallback(() => {
    void refreshThreads();
    if (currentThreadId) void hydrate(currentThreadId);
  }, [currentThreadId, hydrate, refreshThreads]);

  const context = useMemo<WorkbenchContextValue>(
    () => ({
      config,
      debug: { state, loading, error },
      threads,
      currentThreadId,
      isRunning,
      operationError: error,
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

async function streamWorkbenchRun(
  runUrl: string,
  body: { threadId: string; text: string; clientId?: string; attachments?: WorkbenchAttachment[] },
  signal: AbortSignal,
  onPayload: (payload: unknown) => void,
): Promise<void> {
  const response = await fetch(runUrl, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: run`);
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (block: string) => {
    const line = block.split("\n").find((entry) => entry.startsWith("data: "));
    if (!line) return;
    onPayload(JSON.parse(line.slice("data: ".length)) as unknown);
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) emit(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) emit(buffer);
}

function readState(payload: unknown): WorkbenchState | undefined {
  const state = readRecord(payload)?.state;
  return isWorkbenchState(state) ? state : undefined;
}

function toSummaries(threads: unknown[]): StoredThreadSummary[] {
  const summaries = threads.flatMap((thread): StoredThreadSummary[] => {
    const record = readRecord(thread);
    const id = readString(record?.threadId) ?? readString(record?.id);
    if (!record || !id) return [];
    return [
      {
        id,
        title: readString(record.title) ?? shortId(id),
        updatedAt: readString(record.updatedAt) ?? new Date(0).toISOString(),
        messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
        persisted: true,
        promptActive: typeof record.promptActive === "boolean" ? record.promptActive : undefined,
        cwd: readString(record.cwd),
      },
    ];
  });
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json().catch(() => ({}));
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
