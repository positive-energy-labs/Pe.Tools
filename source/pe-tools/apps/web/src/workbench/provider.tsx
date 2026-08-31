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
import type { PeaWorldDescriptor } from "@pe/agent-contracts";
import { peUrl, resolveWorkbenchConfig, type WorkbenchEndpointConfig } from "./config";
import {
  accessLevelFromPermissions,
  applyEvent,
  emptyChatState,
  hydrateChatState,
  readRecord,
  readString,
  selectApprovals,
  selectRunStatus,
  shortId,
  PERMISSION_LEVELS,
  type AccessLevel,
  type ChatState,
  type PeInspect,
} from "./chat-state";
import { usePeInfo } from "#/host/info";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { createChatPageStore, type ChatPageStore, type WorkbenchAttachment } from "./store";

export type { WorkbenchAttachment } from "./store";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

type ToolResume = string | string[] | PlanResume;
type MessageFile = { data: string; mediaType: string; filename?: string };

const MESSAGE_LIMIT = 200;

/** The session client type, derived from the SDK (its class type isn't re-exported at the root). */
type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;

/** Connection handshake — which controller/session the native routes drive. */
export interface WorkbenchContextValue {
  store: ChatPageStore;
  config: WorkbenchEndpointConfig;
  chat: ChatState;
  loading: boolean;
  error?: string;
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
  forkThread: () => Promise<void>;
  openThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (toolCallId: string, optionId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAccessLevel: (accessLevel: AccessLevel) => Promise<void>;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/chat" });
  // URL is canonical for which thread is open. Everything below is server-derived cache.
  const search = useSearch({ from: "/chat" });
  const { thread } = search;
  const currentThreadId = thread ?? "";
  const store = useRouteStore(() =>
    createChatPageStore({
      registry: appAtomRegistry,
      search: {
        ...search,
        patch: (partial, replace = false) =>
          navigate({ search: (previous) => ({ ...previous, ...partial }), replace }),
      },
    }),
  );

  const infoQuery = usePeInfo(config);
  const info = infoQuery.data;
  const [chat, setChat] = useState<ChatState>(emptyChatState);
  const chatRef = useRef(chat);
  chatRef.current = chat;
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

  const status = selectRunStatus(chat);
  const isRunning = status === "running" || status === "waiting";

  /** Replace the URL thread param (no history spam on auto-landing / switching). */
  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  const refreshThreads = useCallback(async () => {
    if (!api) return;
    try {
      setThreads(toSummaries(await api.session.listThreads()));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [api]);

  /** Seed the state a thread starts from. Live truth then arrives as `display_state_changed`. */
  const hydrate = useCallback(
    async (threadId: string, options?: { silent?: boolean }) => {
      if (!api) return;
      if (!options?.silent) setLoading(true);
      try {
        const [session, messages, inspect, models, permissions] = await Promise.all([
          api.session.state({ threadId }).catch(() => undefined),
          api.session.listMessages(threadId, MESSAGE_LIMIT).catch(() => []),
          fetchPeInspect(config).catch(() => ({}) as PeInspect),
          api.controller.listModels().catch(() => []),
          api.session.getPermissions().catch(() => undefined),
        ]);
        setChat(hydrateChatState({ session, messages, inspect, models, permissions }));
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [api, config],
  );

  useEffect(() => {
    if (!infoQuery.error) return;
    setLoading(false);
    setError(errorMessage(infoQuery.error));
  }, [infoQuery.error]);

  useEffect(() => {
    if (!currentThreadId) void gotoThread(mintedThreadId, true);
  }, [currentThreadId, gotoThread, mintedThreadId]);

  // The URL owns this provider's immutable session. Navigation replaces the whole lifecycle.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let unsubscribe = () => {};
    const terminalError = (caught: unknown) => {
      if (cancelled) return;
      setError(errorMessage(caught));
      setChat((previous) => applyEvent(previous, { type: "agent_end", reason: "error" }));
    };
    void (async () => {
      try {
        setChat(emptyChatState());
        setLoading(true);
        await api.session.create({ threadId: currentThreadId });
        if (cancelled) return;
        await Promise.all([refreshThreads(), hydrate(currentThreadId)]);
        if (cancelled) return;
        const subscription = await api.session.subscribe({
          reconnect: true,
          onReconnect: () => void hydrate(currentThreadId, { silent: true }),
          onEvent: (event) => {
            if (!isKnownAgentControllerEvent(event)) return;
            setChat((previous) => applyEvent(previous, event));
            if (event.type === "thread_created" || event.type === "thread_deleted") {
              void refreshThreads();
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
      // stream confirms via display_state_changed. Images render from the in-hand base64.
      const files = toFiles(attachments);
      setChat((previous) => ({
        ...applyEvent(previous, {
          type: "message_start",
          message: optimisticMessage(prompt, files),
        }),
        display: { ...previous.display, isRunning: true },
        errors: [],
      }));
      setError(undefined);
      try {
        await api.session.sendMessage({ content: prompt, files });
      } catch (caught) {
        setError(errorMessage(caught));
        setChat((previous) => ({
          ...previous,
          display: { ...previous.display, isRunning: false },
        }));
      }
    },
    [api],
  );

  const cancel = useCallback(() => {
    if (!api) return;
    for (const approval of selectApprovals(chatRef.current.display)) {
      void rejectApproval(api.session, approval).catch(() => undefined);
    }
    void api.session.abort().catch(() => undefined);
    setChat((previous) => ({ ...previous, display: { ...previous.display, isRunning: false } }));
  }, [api]);

  const newThread = useCallback(() => {
    void gotoThread(crypto.randomUUID());
  }, [gotoThread]);

  const forkThread = useCallback(async () => {
    if (!api || !currentThreadId) return;
    try {
      await forkSessionThread(api.session, currentThreadId, gotoThread);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [api, currentThreadId, gotoThread]);

  const openThread = useCallback(
    (threadId: string) => {
      void gotoThread(threadId); // hydrate effect reacts to the URL change
    },
    [gotoThread],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!api) return;
      try {
        await deleteSessionThread(api.session, currentThreadId, threadId, gotoThread);
      } catch (caught) {
        setError(errorMessage(caught));
      }
      await refreshThreads();
    },
    [api, currentThreadId, gotoThread, refreshThreads],
  );

  const resolveApproval = useCallback(
    async (toolCallId: string, optionId?: string) => {
      if (!api) return;
      const reject = optionId?.startsWith("reject") ?? false;
      const approval = selectApprovals(chatRef.current.display).find(
        (item) => item.toolCallId === toolCallId,
      );
      // Optimistically clear the gate so the inline buttons disappear; the stream confirms with
      // the next display state.
      setChat((previous) => ({ ...previous, display: withoutGate(previous.display, toolCallId) }));
      try {
        if (approval?.suspended) {
          await api.session.respondToToolSuspension(
            toolCallId,
            resumeDataForSuspension(approval.toolName, approval.suspendPayload, reject),
          );
        } else {
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
      // No optimistic write: `model_changed` lands on the stream.
      try {
        await api.session.switchModel(modelId);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const setAccessLevel = useCallback(
    async (accessLevel: AccessLevel) => {
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
        // Re-read rather than assume: the server owns the rules, and the collapse to a named
        // level is only true if every category landed.
        const rules = await api.session.getPermissions().catch(() => undefined);
        setChat((previous) => ({ ...previous, access: accessLevelFromPermissions(rules) }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const operationError = error ?? chat.errors[0];
  // Memoized on `chat` (which changes per event anyway): a fresh context object per render
  // re-renders every consumer, and the Lens re-renders itself on each moment mount — the two
  // together are an infinite loop, not just churn.
  const context = useMemo<WorkbenchContextValue>(
    () => ({
      store,
      config,
      chat,
      loading,
      error,
      threads,
      currentThreadId,
      revit: info?.capabilities.revit,
      world: info?.world,
      isRunning,
      operationError,
      sendPrompt,
      cancel,
      newThread,
      forkThread,
      openThread,
      deleteThread,
      resolveApproval,
      setModel,
      setAccessLevel,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      chat,
      loading,
      error,
      threads,
      currentThreadId,
      info,
      isRunning,
      operationError,
      store,
      config,
    ],
  );

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

/** Drop a resolved call from both native gates (single-slot approval, keyed suspensions). */
export function withoutGate(
  display: ChatState["display"],
  toolCallId: string,
): ChatState["display"] {
  const suspensions = { ...display.pendingSuspensions };
  delete suspensions[toolCallId];
  return {
    ...display,
    pendingApproval:
      display.pendingApproval?.toolCallId === toolCallId ? null : display.pendingApproval,
    pendingSuspensions: suspensions,
  };
}

export async function forkSessionThread(
  session: Pick<SessionClient, "cloneThread">,
  currentThreadId: string,
  gotoThread: (threadId: string) => Promise<void>,
) {
  const clone = await session.cloneThread({ sourceThreadId: currentThreadId });
  await gotoThread(clone.id);
}

export async function deleteSessionThread(
  session: Pick<SessionClient, "deleteThread">,
  currentThreadId: string,
  threadId: string,
  gotoThread: (threadId: string) => Promise<void>,
) {
  if (threadId === currentThreadId) await gotoThread(crypto.randomUUID());
  await session.deleteThread(threadId);
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
  approval: { toolCallId: string; toolName: string; suspended: boolean; suspendPayload?: unknown },
): Promise<void> {
  if (approval.suspended) {
    await session.respondToToolSuspension(
      approval.toolCallId,
      resumeDataForSuspension(approval.toolName, approval.suspendPayload, true),
    );
    return;
  }
  await session.approveTool(approval.toolCallId, false);
}

/** Map composer attachments to native `Session.sendMessage({ content, files })`. */
function toFiles(attachments: WorkbenchAttachment[] | undefined): MessageFile[] | undefined {
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

async function fetchPeInspect(config: WorkbenchEndpointConfig): Promise<PeInspect> {
  const response = await fetch(peUrl(config, "/inspect"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};
  return (await response.json().catch(() => ({}))) as PeInspect;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
