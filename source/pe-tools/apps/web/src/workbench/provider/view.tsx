import { CHAT_ACTIONS } from "../actions";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MastraClient, type PermissionPolicy, type ToolCategory } from "@mastra/client-js";
import type { ToolResume } from "./thread-summary";
import { resolveWorkbenchConfig } from "../config";
import {
  selectApprovals,
  selectRunStatus,
  PERMISSION_LEVELS,
  type AccessLevel,
} from "../chat-state";
import { previousOf, useHostStatus } from "#/readings";
import { appAtomRegistry } from "#/route";
import { useRouteOwner } from "#/route";
import { createChatPageStore, type WorkbenchAttachment } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
import { useThreadStream } from "./thread-stream";
import {
  errorMessage,
  forkSessionThread,
  resumeDataForSuspension,
  toSummaries,
} from "./use-workbench";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/chat" });
  const search = useSearch({ from: "/chat" });
  const [currentThreadId] = useState(() => search.thread ?? crypto.randomUUID());
  const store = useRouteOwner(() =>
    createChatPageStore({
      registry: appAtomRegistry,
      search: {
        ...search,
        patch: (partial, replace = false) =>
          navigate({ search: (previous) => ({ ...previous, ...partial }), replace }),
      },
    }),
  );

  // The one `host-status` Reading. Its own lifecycle is the freshness claim; `previousOf` keeps
  // the last good answer through loading and failure so the surface never invents one.
  const hostStatus = useHostStatus();
  const info = previousOf(hostStatus);
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const [error, setError] = useState<string>();
  const settlingApprovalsRef = useRef(new Set<string>());

  const session = useMemo(() => {
    if (!info?.controllerId || !info.resourceId) return undefined;
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

  const {
    chat,
    pending: threadPending,
    error: streamFault,
    invalidate,
  } = useThreadStream({
    origin: config.origin,
    thread: session ? { id: currentThreadId, session } : null,
  });
  const loading = hostStatus.state === "loading" || threadPending;

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
      try {
        setError(undefined);
        // The host admits the turn under the thread's Scope; the browser names no target.
        const context = { session, display: chat.display };
        const refusal = CHAT_ACTIONS.send.ready(context, { text, attachments });
        if (refusal) {
          setError(refusal);
          return;
        }
        await CHAT_ACTIONS.send.run(context, { text, attachments });
        if (threadPending) await invalidate();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [invalidate, session, threadPending, chat.display],
  );

  const cancel = useCallback(() => {
    if (!session) return;
    void CHAT_ACTIONS.cancel
      .run({ session, display: chat.display })
      .catch((caught: unknown) => setError(errorMessage(caught)));
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
    async (toolCallId: string, response?: ToolResume) => {
      if (!session) return;
      // Settlement is server-only: the patched Mastra core clears the gate
      // and re-emits display state when the approval actually disarms. The client never removes
      // the gate itself; it only refuses a second send while one is in flight.
      if (settlingApprovalsRef.current.has(toolCallId)) return;
      settlingApprovalsRef.current.add(toolCallId);
      const approval = selectApprovals(chat.display).find((item) => item.toolCallId === toolCallId);
      try {
        if (approval?.kind === "suspension") {
          await session.respondToToolSuspension(
            toolCallId,
            resumeDataForSuspension(approval.toolName, approval.payload, response),
          );
        } else {
          await session.approveTool(toolCallId, response !== "reject_once");
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
      await invalidate();
    },
    [config.origin, invalidate],
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
        await invalidate();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [invalidate, session],
  );

  const operationError =
    error ?? (hostStatus.state === "failed" ? hostStatus.message : streamFault?.message);
  const context = useMemo<WorkbenchContextValue>(
    () => ({
      store,
      config,
      session,
      chat,
      loading,
      error,
      threads,
      currentThreadId,
      revit: info?.capabilities.revit,
      world: info?.world as WorkbenchContextValue["world"],
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
      session,
    ],
  );

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}
