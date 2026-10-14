import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { resolveWorkbenchConfig } from "../config";
import { selectRunStatus, selectTurnFailure } from "@pe/agent-contracts/chat-state";
import { previousOf, useHostStatus } from "#/readings";
import { appAtomRegistry, useRouteOwner } from "#/route/route-owner";
import { createChatPageStore } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
import { chatLoading, useThreadStream } from "./thread-stream";
import { harnessClient, notFound, type PromptRequest } from "./harness-client";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { CHAT_SEEDS } from "#/chat/seeds";
import { errorMessage } from "./use-workbench";
import { EMPTY_HEAD, isReady, useProviders, type HeadDraft } from "./providers";
import { targetKey, type DocumentRequest } from "@pe/agent-contracts";
import { demoThreads } from "#/chat/thread-navigation";
import { mergeThreadRoster, mergeThreadSummary } from "./thread-merge";
import { emptyPrompt } from "../prompt";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate({ from: "/pea" });
  const search = useSearch({ from: "/pea" });
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
  const rosterEpoch = useRef(0);
  const [draft, setDraft] = useState<HeadDraft>(EMPTY_HEAD);
  const [draftTarget, setDraftTarget] = useState<DocumentRequest | null>(null);
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
    const started = rosterEpoch.current;
    const listed = await client.threads();
    if (started === rosterEpoch.current)
      setThreads((current) => mergeThreadRoster(current, listed));
  }, [client, demo]);
  useEffect(() => {
    if (demo) {
      setThreads(demoThreads(demo));
      return;
    }
    return client.summaries(
      (listed) => {
        rosterEpoch.current++;
        setThreads((current) => mergeThreadRoster(current, listed));
      },
      (caught) => setError(errorMessage(caught)),
    );
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
    void attempt(refreshThreads);
  }, [attempt, demo, loading, refreshThreads]);
  const providers = useProviders(config.origin, !demo);

  const gotoThread = useCallback(
    (threadId: string, replace = false) => store.actions.openThread(threadId, replace),
    [store],
  );

  /** The draft's provider: the pick, or Pea default = the first ready one. */
  const drafted = draft.providerId
    ? providers.list?.find((item) => item.id === draft.providerId)
    : providers.list?.find(isReady);
  /** The provider the open thread is bound to; a thread never changes provider. */
  const bound = currentThreadId
    ? providers.list?.find(
        (item) =>
          item.id ===
          (chat.providerId || threads.find((t) => t.id === currentThreadId)?.providerId),
      )
    : undefined;
  /** Why a send cannot go now, in the provider's own words, or undefined when it can. */
  const sendRefusal = demo
    ? undefined
    : !providers.list
      ? "Providers are loading"
      : currentThreadId
        ? bound && !isReady(bound)
          ? `${bound.name} is not ready: ${bound.readiness.state === "ready" ? "" : bound.readiness.message}`
          : undefined
        : !providers.list.some(isReady)
          ? "no provider is ready"
          : drafted && !isReady(drafted)
            ? `${drafted.name} is not ready`
            : undefined;

  /** Binds the draft: the thread is created on its provider, then takes the draft's model and traits. */
  const createThread = useCallback(async () => {
    if (sendRefusal || !drafted) throw Error(sendRefusal ?? "no provider is ready");
    const created = await client.create(drafted.id);
    if (draftTarget) {
      const displayLabel = threads.find(
        (thread) => targetKey(thread.head.defaultTarget) === targetKey(draftTarget),
      )?.head.displayLabel;
      const outcome = await client.target(created.id, {
        defaultTarget: draftTarget,
        revision: created.head.revision,
        displayLabel,
      });
      if (!outcome.ok)
        throw Error("The new thread target changed; choose its target before sending");
    }
    if (draft.modelId && draft.modelId !== created.modelId)
      await client.model(created.id, draft.modelId);
    for (const [id, value] of Object.entries(draft.traits))
      await client.trait(created.id, id, value);
    await refreshThreads();
    await gotoThread(created.id);
    return created.id;
  }, [client, draft, draftTarget, drafted, gotoThread, sendRefusal, refreshThreads]);

  const sendPrompt = useCallback(
    async (input: PromptRequest) => {
      const text = input.text.trim();
      const empty = emptyPrompt(input);
      if (empty) throw Error(empty);
      // A send on a running turn is the host's interrupt; the browser never gates on it.
      const ok = await attempt(async () =>
        client.prompt(currentThreadId || (await createThread()), { ...input, text }),
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
    (threadId: string, providerId?: string) =>
      attempt(async () => {
        const forked = await client.fork(threadId, providerId);
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
      providers,
      draft,
      setDraft,
      draftTarget,
      setDraftTarget,
      sendRefusal,
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
      newThread: async (target = null) => {
        setDraftTarget(target);
        await navigate({ search: (previous) => ({ ...previous, thread: undefined }) });
      },
      updateThread: (threadId, change) =>
        attempt(async () => {
          if (demo && change.readSeq !== undefined) return;
          if (demo)
            throw Error(
              "Fixture threads are read-only; open a real thread to change its lifecycle",
            );
          const current =
            threads.find((item) => item.id === threadId) ??
            (chat.id === threadId ? chat : undefined);
          const updated = await client
            .update(threadId, {
              expectedRevision: current?.lifecycle.revision,
              ...change,
            })
            .catch((caught) => {
              if (
                change.readSeq !== undefined &&
                change.explicitUnread === undefined &&
                (caught as { status?: number }).status === 409
              )
                return undefined;
              throw caught;
            });
          if (!updated) return;
          setThreads((previous) =>
            previous.map((item) =>
              item.id === updated.id ? mergeThreadSummary(item, updated) : item,
            ),
          );
        }),
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
      forkThread: async (providerId, threadId) =>
        void (await forkThread(threadId || currentThreadId, providerId)),
      setModel: async (modelId) => onThread((id) => client.model(id, modelId))(),
      setTrait: async (traitId, value) => onThread((id) => client.trait(id, traitId, value))(),
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
      draft,
      draftTarget,
      info,
      isRunning,
      loading,
      missingThread,
      sendRefusal,
      onThread,
      operationError,
      patchThreadView,
      providers,
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
