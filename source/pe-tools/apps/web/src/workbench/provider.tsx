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
import {
  MastraClient,
  isKnownAgentControllerEvent,
  type AgentControllerThreadInfo,
  type MastraDBMessage,
  type PermissionPolicy,
  type PlanResume,
  type ToolCategory,
} from "@mastra/client-js";
import {
  createWorkbenchState,
  peInfoSchema,
  selectPendingApprovals,
  type PeInfo,
  type PeaWorldDescriptor,
  type WorkbenchAccessLevel,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { peUrl, resolveWorkbenchConfig, type WorkbenchEndpointConfig } from "./config";
import { applyAgentControllerEvent, hydrateWorkbenchState, type PeInspect } from "./adapter";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Composer attachment: text files carry `text`, binary/image carry base64 `data`. */
export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

type ToolResume = string | string[] | PlanResume;
type MessageFile = { data: string; mediaType: string; filename?: string };

const MESSAGE_LIMIT = 200;
const PERMISSION_LEVELS = {
  "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
  ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
  trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
} as const satisfies Record<
  WorkbenchAccessLevel,
  Record<ToolCategory, PermissionPolicy>
>;

/** The session client type, derived from the SDK (its class type isn't re-exported at the root). */
type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;

/** Connection handshake — which controller/session the native routes drive. */
interface WorkbenchContextValue {
  config: WorkbenchEndpointConfig;
  debug: { state: WorkbenchState; loading: boolean; error?: string };
  threads: StoredThreadSummary[];
  /** Derived from the URL `thread` search param — the single source of truth for "which thread". */
  currentThreadId: string;
  revit?: boolean;
  world?: PeaWorldDescriptor;
  isRunning: boolean;
  operationError?: string;
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  openThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAccessLevel: (accessLevel: WorkbenchAccessLevel) => Promise<void>;
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
  const [mintedThreadId] = useState(() => crypto.randomUUID());

  // The native session + controller clients. `baseUrl` is the workbench origin; the SDK's default
  // apiPrefix (`/api`) matches where Pe mounts the @mastra/server routes.
  const api = useMemo(() => {
    if (!info || !currentThreadId) return undefined;
    const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
      info.controllerId,
    );
    return { controller, session: controller.session(info.resourceId, currentThreadId) };
  }, [config.origin, currentThreadId, info]);

  const isRunning =
    state.uiStatus.overall.status === "running" || state.uiStatus.overall.status === "waiting";

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
        const [display, messages, inspect, models, modes, permissions] = await Promise.all([
          api.session.state({ threadId }).catch(() => undefined),
          api.session.listMessages(threadId, MESSAGE_LIMIT).catch(() => []),
          fetchPeInspect(config).catch(() => ({}) as PeInspect),
          api.controller.listModels().catch(() => []),
          api.controller.listModes().catch(() => []),
          api.session.getPermissions().catch(() => undefined),
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
            permissions,
          }),
        );
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, info, config],
  );

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const hydrateRef = useRef(hydrate);
  hydrateRef.current = hydrate;
  const refreshThreadsRef = useRef(refreshThreads);
  refreshThreadsRef.current = refreshThreads;

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

  useEffect(() => {
    if (!currentThreadId) gotoThread(mintedThreadId, true);
  }, [currentThreadId, gotoThread, mintedThreadId]);

  // The URL owns this provider's immutable session. Navigation replaces the whole lifecycle.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let unsubscribe = () => {};
    const terminalError = (caught: unknown) => {
      if (cancelled) return;
      setError(errorMessage(caught));
      setState((previous) =>
        applyAgentControllerEvent(previous, { type: "agent_end", reason: "error" }),
      );
    };
    void (async () => {
      try {
        setState(createWorkbenchState());
        setLoading(true);
        await api.session.create({ threadId: currentThreadId });
        if (cancelled) return;
        await Promise.all([refreshThreads(), hydrate(currentThreadId)]);
        if (cancelled) return;
        const subscription = await api.session.subscribe({
          reconnect: true,
          onReconnect: () => void hydrateRef.current(currentThreadId, { silent: true }),
          onEvent: (event) => {
            if (!isKnownAgentControllerEvent(event)) return;
            setState((previous) => applyAgentControllerEvent(previous, event));
            if (event.type === "thread_created" || event.type === "thread_deleted") {
              void refreshThreadsRef.current();
            }
            if (
              event.type === "agent_end" &&
              event.reason !== "suspended" &&
              selectPendingApprovals(stateRef.current).length === 0
            ) {
              void hydrateRef.current(currentThreadId, { silent: true });
            }
          },
          onError: terminalError,
        });
        if (cancelled) subscription.unsubscribe();
        else unsubscribe = subscription.unsubscribe;
      } catch (caught) {
        terminalError(caught);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, currentThreadId, hydrate, refreshThreads]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      // An image-only send (empty text) is valid — guard on "nothing to send", not "no text".
      if ((!prompt && !attachments?.length) || !api) return;
      // Optimistically show the user's turn (text + any attached images) + running state; the
      // stream confirms via agent_start. Images render from the in-hand base64, no server echo needed.
      const files = toFiles(attachments);
      setState((previous) => ({
        ...applyAgentControllerEvent(previous, {
          type: "message_start",
          message: optimisticMessage(prompt, files),
        }),
        uiStatus: {
          ...previous.uiStatus,
          overall: { ...previous.uiStatus.overall, status: "running" },
        },
      }));
      setError(undefined);
      try {
        await api.session.sendMessage({ content: prompt, files });
      } catch (caught) {
        setError(errorMessage(caught));
        setState((previous) => applyAgentControllerEvent(previous, { type: "agent_end" }));
      }
    },
    [api],
  );

  const cancel = useCallback(() => {
    if (!api) return;
    for (const approval of selectPendingApprovals(stateRef.current)) {
      void rejectApproval(
        api.session,
        approval.requestId,
        approval.toolCall.title,
        approval.toolCall.rawOutput,
      ).catch(() => undefined);
    }
    void api.session.abort().catch(() => undefined);
    setState((previous) => applyAgentControllerEvent(previous, { type: "agent_end" }));
  }, [api]);

  const newThread = useCallback(() => {
    gotoThread(crypto.randomUUID());
  }, [gotoThread]);

  const openThread = useCallback(
    (threadId: string) => {
      gotoThread(threadId); // hydrate effect reacts to the URL change
    },
    [gotoThread],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!api) return;
      if (threadId === currentThreadId) {
        setError("Open another thread before deleting the current thread.");
        return;
      }
      try {
        await api.session.deleteThread(threadId);
      } catch (caught) {
        setError(errorMessage(caught));
      }
      await refreshThreads();
    },
    [api, currentThreadId, refreshThreads],
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
        await Promise.all(
          Object.entries(PERMISSION_LEVELS[accessLevel]).map(([category, policy]) =>
            api.session.setPermissionForCategory(
              category as ToolCategory,
              policy as PermissionPolicy,
            ),
          ),
        );
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

  const operationError = error ?? state.uiStatus.errors[0];
  const context = useMemo<WorkbenchContextValue>(
    () => ({
      config,
      debug: { state, loading, error },
      threads,
      currentThreadId,
      revit: info?.capabilities.revit,
      world: info?.world,
      isRunning,
      operationError,
      sendPrompt,
      cancel,
      newThread,
      openThread,
      deleteThread,
      resolveApproval,
      setModel,
      setAccessLevel,
    }),
    [
      config,
      state,
      loading,
      error,
      operationError,
      threads,
      currentThreadId,
      info?.capabilities.revit,
      info?.world,
      isRunning,
      sendPrompt,
      cancel,
      newThread,
      openThread,
      deleteThread,
      resolveApproval,
      setModel,
      setAccessLevel,
    ],
  );

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

/** Preserve the built-in suspension payloads expected by MastraCode tools. */
export function resumeDataForSuspension(
  toolName: string | undefined,
  suspendPayload: unknown,
  reject: boolean,
): ToolResume {
  const payload = readRecord(suspendPayload);
  if (toolName === "submit_plan") {
    return {
      action: reject ? "rejected" : "approved",
      ...(reject ? { feedback: "Rejected from workbench." } : {}),
      ...copyStrings(payload, ["path", "title", "plan"]),
    };
  }
  if (toolName === "request_access") return reject ? "No" : "Yes";
  if (toolName === "ask_user") {
    if (reject) return "(skipped)";
    const options = readArray(payload?.options)?.map(optionText).filter(Boolean) as
      | string[]
      | undefined;
    const first = options?.[0] ?? "Approved";
    return payload?.selectionMode === "multiple" ? [first] : first;
  }
  return reject ? "Rejected" : "Approved";
}

async function rejectApproval(
  session: SessionClient,
  requestId: string,
  toolName: string | undefined,
  suspendPayload: unknown,
): Promise<void> {
  if (requestId.startsWith("tool-suspended:")) {
    await session.respondToToolSuspension(
      requestId.slice("tool-suspended:".length),
      resumeDataForSuspension(toolName, suspendPayload, true),
    );
    return;
  }
  await session.approveTool(
    requestId.startsWith("tool-approval:") ? requestId.slice("tool-approval:".length) : requestId,
    false,
  );
}

/** Map composer attachments to native `Session.sendMessage({ content, files })`. */
function toFiles(
  attachments: WorkbenchAttachment[] | undefined,
): MessageFile[] | undefined {
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

function optimisticMessage(content: string, files: MessageFile[] | undefined): MastraDBMessage {
  const parts: MastraDBMessage["content"]["parts"] = [];
  if (content) parts.push({ type: "text", text: content });
  for (const file of files ?? []) {
    parts.push({ type: "file", mimeType: file.mediaType, data: file.data });
  }
  return {
    id: `local-user-${Date.now()}`,
    role: "user",
    createdAt: new Date(),
    content: { format: 2, parts },
  };
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
      // Empty-string titles (not just null) render as blank rows — fall back to a short id.
      title: thread.title?.trim() || shortId(thread.id),
      updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
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

function optionText(value: unknown): string {
  return readString(value) ?? readString(readRecord(value)?.label) ?? "";
}

function copyStrings(
  source: Record<string, unknown> | undefined,
  keys: string[],
): Partial<Pick<PlanResume, "path" | "title" | "plan">> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = readString(source?.[key]);
      return value ? [[key, value]] : [];
    }),
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
