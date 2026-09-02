import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MastraClient, type PermissionPolicy, type ToolCategory } from "@mastra/client-js";
import { resolveWorkbenchConfig } from "../config";
import {
  accessLevelFromPermissions,
  applyEvent,
  emptyChatState,
  selectApprovals,
  selectRunStatus,
  PERMISSION_LEVELS,
  type AccessLevel,
  type ChatEvent,
  type ChatState,
} from "../chat-state";
import { usePeInfo } from "#/host/info";
import { useLedger } from "#/host/ledger";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { createChatPageStore, type WorkbenchAttachment } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
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
  // What the user is looking at when they send: rides every message as its `binding`.
  const doc = useSearch({
    strict: false,
    select: (value) => (value as { doc?: string | null }).doc ?? null,
  });
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
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mintedThreadId] = useState(() => crypto.randomUUID());
  // The host ledger exists once the session is materialized; null until then (or for a draft thread).
  const [ledgerName, setLedgerName] = useState<string | null>(null);
  const settlingApprovalsRef = useRef(new Set<string>());

  const api = useMemo(() => {
    if (!info || !currentThreadId) return undefined;
    const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
      info.controllerId,
    );
    return { controller, session: controller.session(info.resourceId, currentThreadId) };
  }, [config.origin, currentThreadId, info]);

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

  const openLedger = useCallback(async () => {
    if (!api) throw new Error("thread is not ready");
    await api.session.create({ threadId: currentThreadId });
    setLedgerName(`thread:${currentThreadId}`);
  }, [api, currentThreadId]);

  const [chat, dispatch, ready] = useLedger<ChatEvent, ChatState>(
    ledgerName,
    applyEvent,
    emptyChatState,
    {
      onEntry: (entry) => {
        if (entry.type === "thread_created" || entry.type === "thread_deleted") {
          void refreshThreads();
        }
      },
      // The host restarted: its thread ledger is gone until the session is materialized again.
      onClosed: () => {
        setLedgerName(null);
        void openLedger().catch((caught) => setError(errorMessage(caught)));
      },
    },
  );
  const loading = threadsLoading || (ledgerName !== null && !ready);

  const status = selectRunStatus(chat);
  const isRunning = status === "running" || status === "waiting";

  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  useEffect(() => {
    if (!infoQuery.error) return;
    setThreadsLoading(false);
    setError(errorMessage(infoQuery.error));
  }, [infoQuery.error]);

  useEffect(() => {
    if (!currentThreadId) void gotoThread(mintedThreadId, true);
  }, [currentThreadId, gotoThread, mintedThreadId]);

  // A stored thread opens its ledger now; a draft thread waits for its first send.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLedgerName(null);
    setThreadsLoading(true);
    void (async () => {
      try {
        const available = await refreshThreads();
        if (cancelled) return;
        if (available?.some((item) => item.id === currentThreadId)) await openLedger();
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setThreadsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, currentThreadId, openLedger, refreshThreads]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      if ((!prompt && !attachments?.length) || !api) return;
      const files = toFiles(attachments);
      const clientMessageId = crypto.randomUUID();
      try {
        if (!ledgerName) await openLedger();
        dispatch({
          type: "message_start",
          message: optimisticMessage(clientMessageId, prompt, files),
        });
        dispatch({ type: "patch", patch: { display: { isRunning: true }, errors: [] } });
        setError(undefined);
        await api.session.sendMessage(
          { content: prompt, files },
          { requestContext: { clientMessageId, binding: { doc, target: search.target ?? null } } },
        );
      } catch (caught) {
        setError(errorMessage(caught));
        dispatch({ type: "patch", patch: { display: { isRunning: false } } });
      }
    },
    [api, dispatch, doc, ledgerName, openLedger, search.target],
  );

  const cancel = useCallback(() => {
    if (!api) return;
    for (const approval of selectApprovals(chat.display)) {
      void rejectApproval(api.session, approval).catch(() => undefined);
    }
    void api.session.abort().catch(() => undefined);
    dispatch({ type: "patch", patch: { display: { isRunning: false } } });
  }, [api, chat.display, dispatch]);

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
        setThreads((previous) => previous.filter((item) => item.id !== threadId));
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
      const approval = selectApprovals(chat.display).find((item) => item.toolCallId === toolCallId);
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
    [api, chat.display],
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
        dispatch({ type: "patch", patch: { access: accessLevelFromPermissions(rules) } });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [api, dispatch],
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
