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
  applyWorkbenchEvent,
  createWorkbenchState,
  isWorkbenchEvent,
  type WorkbenchEvent,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { resolveWorkbenchConfig, workbenchUrl, type WorkbenchEndpointConfig } from "./config.ts";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  persisted: boolean;
  promptActive?: boolean;
  cwd?: string;
}

interface WorkbenchContextValue {
  config: WorkbenchEndpointConfig;
  debug: { state: WorkbenchState; loading: boolean; error?: string };
  threads: StoredThreadSummary[];
  currentThreadId: string;
  isRunning: boolean;
  operation?: string;
  operationError?: string;
  sendPrompt: (text: string) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  switchThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  refreshProjection: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const [state, setState] = useState<WorkbenchState>(() => createWorkbenchState());
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const initedRef = useRef(false);

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
        const payload = await fetchJson(workbenchUrl(config, "/workbench/hydrate", { threadId }));
        const events = readArray(readRecord(payload)?.events) ?? [];
        let next = createWorkbenchState();
        for (const event of events) {
          if (isWorkbenchEvent(event)) next = applyWorkbenchEvent(next, event);
        }
        setState(next);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [config],
  );

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
          setLoading(false);
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
  }, [config, hydrate]);

  const sendPrompt = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setError(undefined);
      try {
        await streamWorkbenchRun(
          workbenchUrl(config, "/workbench/run"),
          { threadId: currentThreadId, text: prompt },
          controller.signal,
          (event) => setState((previous) => applyWorkbenchEvent(previous, event)),
        );
        if (!controller.signal.aborted) void refreshThreads();
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsRunning(false);
      }
    },
    [config, currentThreadId, refreshThreads],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCurrentThreadId(crypto.randomUUID());
    setState(createWorkbenchState());
    setLoading(false);
    setIsRunning(false);
  }, []);

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

  const context = useMemo<WorkbenchContextValue>(
    () => ({
      config,
      debug: { state, loading, error },
      threads,
      currentThreadId,
      isRunning,
      operationError: error,
      sendPrompt,
      cancel,
      newThread,
      switchThread,
      deleteThread,
      refreshProjection: () => void refreshThreads(),
    }),
    [
      config,
      state,
      loading,
      error,
      threads,
      currentThreadId,
      isRunning,
      sendPrompt,
      cancel,
      newThread,
      switchThread,
      deleteThread,
      refreshThreads,
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
  body: { threadId: string; text: string },
  signal: AbortSignal,
  onEvent: (event: WorkbenchEvent) => void,
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
    const parsed = JSON.parse(line.slice("data: ".length)) as unknown;
    if (isWorkbenchEvent(parsed)) onEvent(parsed);
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
        messageCount: 0,
        persisted: true,
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
