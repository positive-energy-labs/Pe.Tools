import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  MastraClient,
  isKnownAgentControllerEvent,
  type PermissionPolicy,
  type ToolCategory,
} from "@mastra/client-js";
import { resolveWorkbenchConfig } from "../config";
import {
  accessLevelFromPermissions,
  applyEvent,
  emptyChatState,
  hydrateChatState,
  selectApprovals,
  selectRunStatus,
  PERMISSION_LEVELS,
  type AccessLevel,
  type ChatState,
  type PeInspect,
} from "../chat-state";
import { usePeInfo } from "#/host/info";
import { fetchPeInspect } from "#/host/inspect";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { createChatPageStore, type WorkbenchAttachment } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { MESSAGE_LIMIT, WorkbenchContext } from "./thread-summary";
import {
  errorMessage,
  forkSessionThread,
  optimisticMessage,
  rejectApproval,
  resumeDataForSuspension,
  toFiles,
  toSummaries,
} from "./use-workbench";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/chat" });
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
  const settlingApprovalsRef = useRef(new Set<string>());
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mintedThreadId] = useState(() => crypto.randomUUID());
  const connectionIdRef = useRef(0);
  const connectionRef = useRef<{
    id: number;
    threadId: string;
    promise: Promise<void>;
    dispose: () => void;
  } | null>(null);

  const api = useMemo(() => {
    if (!info || !currentThreadId) return undefined;
    const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
      info.controllerId,
    );
    return { controller, session: controller.session(info.resourceId, currentThreadId) };
  }, [config.origin, currentThreadId, info]);

  const status = selectRunStatus(chat);
  const isRunning = status === "running" || status === "waiting";

  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  const refreshThreads = useCallback(async () => {
    if (!api) return undefined;
    try {
      const next = toSummaries(await api.session.listThreads());
      setThreads(next);
      return next;
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    }
  }, [api]);

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

  const terminalError = useCallback((caught: unknown) => {
    setError(errorMessage(caught));
    setChat((previous) => applyEvent(previous, { type: "agent_end", reason: "error" }));
  }, []);

  const connect = useCallback(() => {
    if (!api || !currentThreadId) return Promise.reject(new Error("thread is not ready"));
    if (connectionRef.current?.threadId === currentThreadId) return connectionRef.current.promise;
    connectionRef.current?.dispose();
    let active = true;
    let unsubscribe = () => {};
    const dispose = () => {
      active = false;
      unsubscribe();
    };
    const id = ++connectionIdRef.current;
    const pending = (async () => {
      await api.session.create({ threadId: currentThreadId });
      if (!active) return;
      await Promise.all([refreshThreads(), hydrate(currentThreadId)]);
      if (!active) return;
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
      if (!active) subscription.unsubscribe();
      else unsubscribe = subscription.unsubscribe;
    })();
    const connection = {
      id,
      threadId: currentThreadId,
      promise: pending.catch((caught) => {
        if (connectionRef.current?.id === id) connectionRef.current = null;
        dispose();
        throw caught;
      }),
      dispose,
    };
    connectionRef.current = connection;
    return connection.promise;
  }, [api, currentThreadId, hydrate, refreshThreads, terminalError]);

  useEffect(() => {
    return () => {
      if (connectionRef.current?.threadId !== currentThreadId) return;
      connectionRef.current.dispose();
      connectionRef.current = null;
    };
  }, [currentThreadId]);

  useEffect(() => {
    if (!infoQuery.error) return;
    setLoading(false);
    setError(errorMessage(infoQuery.error));
  }, [infoQuery.error]);

  useEffect(() => {
    if (!currentThreadId) void gotoThread(mintedThreadId, true);
  }, [currentThreadId, gotoThread, mintedThreadId]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        setChat(emptyChatState());
        setLoading(true);
        const available = await refreshThreads();
        if (cancelled) return;
        if (!available?.some((thread) => thread.id === currentThreadId)) {
          setLoading(false);
          return;
        }
        await connect();
      } catch (caught) {
        if (!cancelled) terminalError(caught);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, connect, currentThreadId, refreshThreads, terminalError]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      if ((!prompt && !attachments?.length) || !api) return;
      const files = toFiles(attachments);
      try {
        await connect();
        setChat((previous) => ({
          ...applyEvent(previous, {
            type: "message_start",
            message: optimisticMessage(prompt, files),
          }),
          display: { ...previous.display, isRunning: true },
          errors: [],
        }));
        setError(undefined);
        await api.session.sendMessage({ content: prompt, files });
      } catch (caught) {
        setError(errorMessage(caught));
        setChat((previous) => ({
          ...previous,
          display: { ...previous.display, isRunning: false },
        }));
      }
    },
    [api, connect],
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
      void gotoThread(threadId);
    },
    [gotoThread],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      const next = title.trim();
      if (!api || !next) return;
      try {
        await api.session.renameThread(threadId, next);
        await refreshThreads();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api, refreshThreads],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!api) return;
      try {
        await api.session.deleteThread(threadId);
        setThreads((previous) => previous.filter((thread) => thread.id !== threadId));
        if (threadId === currentThreadId) await gotoThread(crypto.randomUUID());
        else await refreshThreads();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api, currentThreadId, gotoThread, refreshThreads],
  );

  const resolveApproval = useCallback(
    async (toolCallId: string, optionId?: string) => {
      if (!api) return;
      // Settlement is server-only (ledger 2026-09-01): the patched Mastra core clears the gate
      // and re-emits display state when the approval actually disarms. The client never removes
      // the gate itself; it only refuses a second send while one is in flight.
      if (settlingApprovalsRef.current.has(toolCallId)) return;
      settlingApprovalsRef.current.add(toolCallId);
      const reject = optionId?.startsWith("reject") ?? false;
      const approval = selectApprovals(chatRef.current.display).find(
        (item) => item.toolCallId === toolCallId,
      );
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
      } finally {
        settlingApprovalsRef.current.delete(toolCallId);
      }
    },
    [api],
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!api) return;
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
        const rules = await api.session.getPermissions().catch(() => undefined);
        setChat((previous) => ({ ...previous, access: accessLevelFromPermissions(rules) }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api],
  );

  const operationError = error ?? chat.errors[0];
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
      renameThread,
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
