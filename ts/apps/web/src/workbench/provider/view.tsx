import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { HarnessId, HarnessInfo } from "@pe/agent-contracts";
import { resolveWorkbenchConfig } from "../config";
import { selectRunStatus, selectTurnFailure } from "../chat-state";
import { previousOf, useHostStatus } from "#/readings";
import { appAtomRegistry, useRouteOwner } from "#/route/route-owner";
import { createChatPageStore } from "../store";
import type { WorkbenchAttachment } from "../prompt";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
import { chatLoading, useThreadStream } from "./thread-stream";
import { harnessClient, notFound } from "./harness-client";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { CHAT_SEEDS } from "#/chat/seeds";
import { errorMessage } from "./use-workbench";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/chat" });
  const search = useSearch({ from: "/chat" });
  const currentThreadId = search.thread ?? "";
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

  // The one `host-status` Reading; `previousOf` keeps the last good answer through a refetch.
  const hostStatus = useHostStatus();
  const info = previousOf(hostStatus);
  const client = useMemo(() => harnessClient(config.origin), [config.origin]);
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  // Undefined until the host answered: "new" refuses with a reason rather than throwing.
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>();
  const [error, setError] = useState<string>();

  // `?demo=<seed>`: the transcript shows that seed's thread and nothing is fetched.
  const [demo] = useState(() =>
    typeof location === "undefined"
      ? undefined
      : CHAT_SEEDS[new URLSearchParams(location.search).get("demo") as keyof typeof CHAT_SEEDS]
          ?.work,
  );
  const refreshThreads = useCallback(async () => {
    if (demo) return;
    const listed = await client.threads();
    setThreads([...listed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }, [client, demo]);

  const stream = useThreadStream({
    origin: config.origin,
    threadId: demo || !currentThreadId ? null : currentThreadId,
    onListChange: () => void refreshThreads().catch((caught) => setError(errorMessage(caught))),
  });
  const missingThread = notFound(stream.error);
  const chat = demo ?? stream.chat;
  const bodyAtom = useMemo(
    () => (demo ? Atom.make(AsyncResult.success(demo)) : stream.bodyAtom),
    [demo, stream.bodyAtom],
  );
  const loading = demo ? false : chatLoading(hostStatus, stream.pending);
  const isRunning = selectRunStatus(chat) !== "idle";
  const turnFailure = selectTurnFailure(chat);

  /** Every verb: clear the last complaint, run, and say what failed. */
  const attempt = useCallback(async (run: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await run();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    }
  }, []);

  useEffect(() => {
    if (demo || loading) return;
    void attempt(async () => {
      setHarnesses(await client.harnesses());
      await refreshThreads();
    });
  }, [attempt, client, demo, loading, refreshThreads]);

  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  /** Why no thread can be created now, or undefined when one can. */
  const newRefusal = demo
    ? undefined
    : !harnesses
      ? "Harnesses are loading"
      : harnesses.some((item) => item.available)
        ? undefined
        : (harnesses[0]?.reason ?? "No harness is available");

  /** A thread on `harness`, or the first one that can spawn. */
  const createThread = useCallback(
    async (harness?: HarnessId) => {
      const chosen = harness ?? harnesses?.find((item) => item.available)?.id;
      if (!chosen) throw Error(newRefusal ?? "No harness is available");
      const created = await client.create(chosen);
      await refreshThreads();
      await gotoThread(created.id);
      return created.id;
    },
    [client, gotoThread, harnesses, newRefusal, refreshThreads],
  );

  const sendPrompt = useCallback(
    async (text: string, attachments?: WorkbenchAttachment[]) => {
      const prompt = text.trim();
      if (!prompt) throw Error("Enter a prompt");
      if (attachments?.length) throw Error("Attachments do not cross the harness wire yet");
      // The host queues a send behind a running turn; the browser never gates on it.
      const ok = await attempt(async () =>
        client.prompt(currentThreadId || (await createThread()), prompt),
      );
      if (!ok) throw Error("Send failed");
    },
    [attempt, client, createThread, currentThreadId],
  );

  const onThread = useCallback(
    (run: (threadId: string) => Promise<unknown>) => async () => {
      if (currentThreadId) await attempt(() => run(currentThreadId));
    },
    [attempt, currentThreadId],
  );

  const deleteThread = useCallback(
    (threadId: string) =>
      attempt(async () => {
        await client.remove(threadId);
        setThreads((previous) => previous.filter((item) => item.id !== threadId));
        if (threadId === currentThreadId)
          await navigate({ search: (previous) => ({ ...previous, thread: undefined }) });
      }),
    [attempt, client, currentThreadId, navigate],
  );

  const forkThread = useCallback(
    (threadId: string, harness?: HarnessId) =>
      attempt(async () => {
        const forked = await client.fork(threadId, harness);
        await refreshThreads();
        await gotoThread(forked.id);
      }),
    [attempt, client, gotoThread, refreshThreads],
  );

  const patchThreadView = useCallback(
    (partial: { turn?: number }, replace = false) =>
      navigate({ search: (previous) => ({ ...previous, ...partial }), replace }),
    [navigate],
  );

  // A thread the host does not know is the transcript's empty state, not a fault.
  const operationError =
    error ??
    (hostStatus.state === "failed"
      ? hostStatus.message
      : missingThread
        ? undefined
        : stream.error?.message);
  const context = useMemo<WorkbenchContextValue>(
    () => ({
      store,
      config,
      chat,
      bodyAtom,
      loading,
      error,
      threads,
      harnesses: harnesses ?? [],
      newRefusal,
      missingThread,
      currentThreadId,
      turn: search.turn,
      prompt: search.prompt,
      turnFailure,
      revit: info?.capabilities.revit,
      world: info?.world as WorkbenchContextValue["world"],
      isRunning,
      operationError,
      sendPrompt,
      cancel: onThread((id) => client.cancel(id)),
      newThread: async (harness) => void (await attempt(() => createThread(harness))),
      openThread: (threadId) => void gotoThread(threadId),
      renameThread: async (threadId, title) =>
        void (await attempt(async () => {
          if (!title.trim()) return;
          await client.rename(threadId, title.trim());
          await refreshThreads();
        })),
      deleteThread,
      patchThreadView,
      resolveApproval: async (requestId, optionId) =>
        onThread((id) => client.permission(id, requestId, optionId))(),
      answerQuestion: async (requestId, action, content) =>
        onThread((id) => client.question(id, requestId, action, content))(),
      forkThread: async (harness, threadId) =>
        void (await forkThread(threadId || currentThreadId, harness)),
      setModel: async (modelId) => onThread((id) => client.model(id, modelId))(),
      setMode: async (modeId) => onThread((id) => client.mode(id, modeId))(),
    }),
    [
      attempt,
      bodyAtom,
      chat,
      client,
      config,
      createThread,
      currentThreadId,
      deleteThread,
      error,
      forkThread,
      gotoThread,
      harnesses,
      info,
      isRunning,
      loading,
      missingThread,
      newRefusal,
      onThread,
      operationError,
      patchThreadView,
      refreshThreads,
      search.prompt,
      search.turn,
      sendPrompt,
      store,
      threads,
      turnFailure,
    ],
  );

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}
