import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MastraClient, type PermissionPolicy, type ToolCategory } from "@mastra/client-js";
import { turnScopeContextKey } from "@pe/agent-contracts";
import { resolveWorkbenchConfig } from "../config";
import {
  selectApprovals,
  selectRunStatus,
  PERMISSION_LEVELS,
  type AccessLevel,
} from "../chat-state";
import { usePeInfo } from "#/host/info";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { createChatPageStore, type WorkbenchAttachment } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
import { threadQueryKey, useThreadStream } from "./thread-stream";
import {
  errorMessage,
  forkSessionThread,
  rejectApproval,
  resumeDataForSuspension,
  toFiles,
  toSummaries,
} from "./use-workbench";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/chat" });
  const search = useSearch({ from: "/chat" });
  const [currentThreadId] = useState(() => search.thread ?? crypto.randomUUID());
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
  const [error, setError] = useState<string>();
  const settlingApprovalsRef = useRef(new Set<string>());

  const session = useMemo(() => {
    if (!info) return undefined;
    const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
      info.controllerId,
    );
    return controller.session(info.resourceId, currentThreadId);
  }, [config.origin, currentThreadId, info]);

  const refreshThreads = useCallback(async () => {
    if (!session) return;
    try {
      setThreads(toSummaries(await session.listThreads()));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [session]);

  const [chat, threadPending, streamFault] = useThreadStream({
    origin: config.origin,
    queryClient,
    thread: session ? { id: currentThreadId, session } : null,
  });
  const loading = infoQuery.isPending || threadPending;

  const status = selectRunStatus(chat);
  const isRunning = status !== "idle";

  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  useEffect(() => {
    if (loading || streamFault) return;
    const timer = setTimeout(() => void refreshThreads(), 1_000);
    return () => clearTimeout(timer);
  }, [loading, refreshThreads, streamFault]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      if ((!prompt && !attachments?.length) || !session) return;
      const files = toFiles(attachments);
      const turnId = crypto.randomUUID();
      try {
        setError(undefined);
        await session.sendMessage(
          { content: prompt, files },
          {
            requestContext: {
              [turnScopeContextKey]: {
                id: turnId,
                document: doc,
                target: search.target?.trim() || null,
              },
            },
          },
        );
        if (threadPending)
          await queryClient.resetQueries({
            queryKey: threadQueryKey(config.origin, currentThreadId),
          });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config.origin, currentThreadId, doc, queryClient, search.target, session, threadPending],
  );

  const cancel = useCallback(() => {
    if (!session) return;
    for (const approval of selectApprovals(chat.display))
      void rejectApproval(session, approval).catch((caught) => setError(errorMessage(caught)));
    void session.abort().catch((caught) => setError(errorMessage(caught)));
  }, [chat.display, session]);

  const newThread = useCallback(() => {
    void gotoThread(crypto.randomUUID());
  }, [gotoThread]);

  const forkThread = useCallback(async () => {
    if (!session) return;
    try {
      await forkSessionThread(session, currentThreadId, gotoThread);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [currentThreadId, gotoThread, session]);

  const openThread = useCallback(
    (threadId: string) => {
      void gotoThread(threadId);
    },
    [gotoThread],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      const next = title.trim();
      if (!session || !next) return;
      try {
        await session.renameThread(threadId, next);
        await refreshThreads();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [refreshThreads, session],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!session) return;
      try {
        await session.deleteThread(threadId);
        setThreads((previous) => previous.filter((item) => item.id !== threadId));
        if (threadId === currentThreadId) await gotoThread(crypto.randomUUID());
        else await refreshThreads();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [currentThreadId, gotoThread, refreshThreads, session],
  );

  const resolveApproval = useCallback(
    async (toolCallId: string, optionId?: string) => {
      if (!session) return;
      // Settlement is server-only: the patched Mastra core clears the gate
      // and re-emits display state when the approval actually disarms. The client never removes
      // the gate itself; it only refuses a second send while one is in flight.
      if (settlingApprovalsRef.current.has(toolCallId)) return;
      settlingApprovalsRef.current.add(toolCallId);
      const reject = optionId?.startsWith("reject") ?? false;
      const approval = selectApprovals(chat.display).find((item) => item.toolCallId === toolCallId);
      try {
        if (approval?.suspended) {
          await session.respondToToolSuspension(
            toolCallId,
            resumeDataForSuspension(approval.toolName, approval.suspendPayload, reject),
          );
        } else {
          await session.approveTool(toolCallId, !reject);
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        settlingApprovalsRef.current.delete(toolCallId);
      }
    },
    [chat.display, session],
  );

  const addApiKey = useCallback(
    async (provider: string, apiKey: string) => {
      const response = await fetch(
        `${config.origin}/pe/credentials/${encodeURIComponent(provider)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!response.ok) throw new Error(`credentials ${response.status}`);
      await queryClient.invalidateQueries({
        queryKey: threadQueryKey(config.origin, currentThreadId),
      });
    },
    [config.origin, currentThreadId, queryClient],
  );

  const setModel = useCallback(
    async (modelId: string) => {
      if (!session) return;
      try {
        await session.switchModel(modelId);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [session],
  );

  const setAccessLevel = useCallback(
    async (accessLevel: AccessLevel) => {
      if (!session) return;
      try {
        for (const [category, policy] of Object.entries(PERMISSION_LEVELS[accessLevel]))
          await session.setPermissionForCategory(
            category as ToolCategory,
            policy as PermissionPolicy,
          );
        await queryClient.invalidateQueries({
          queryKey: threadQueryKey(config.origin, currentThreadId),
        });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [config.origin, currentThreadId, queryClient, session],
  );

  const operationError =
    error ?? (infoQuery.error ? errorMessage(infoQuery.error) : streamFault?.message);
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
      addApiKey,
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
