import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch, useRouter, useRouterState } from "@tanstack/react-router";
import { resolveWorkbenchConfig } from "../config";
import { selectRunStatus, selectTurnFailure } from "@pe/agent-contracts/chat-state";
import { previousOf, useHostStatusSlice, useReading } from "#/readings";
import { appAtomRegistry, useRouteOwner } from "#/route/route-owner";
import { createChatPageStore, routeThreadIssue } from "../store";
import type { StoredThreadSummary, WorkbenchContextValue } from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";
import { chatLoading, useThreadStream } from "./thread-stream";
import { harnessClient, notFound, type PromptRequest } from "./harness-client";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { CHAT_SEEDS } from "#/chat/seeds";
import { errorMessage } from "./use-workbench";
import { EMPTY_HEAD, isReady, useProviders, type HeadDraft } from "./providers";
import {
  documentRequestSchema,
  targetKey,
  type DocumentRequest,
  type ThreadHead,
} from "@pe/agent-contracts";
import { demoThreads } from "#/chat/thread-navigation";
import { mergeThreadRoster, mergeThreadSummary } from "./thread-merge";
import { emptyPrompt } from "../prompt";
import { soleUserDocument } from "#/chat/scope";
import { machineOf } from "#/machine/model";
import { useMachine } from "#/machine/use-machine";

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const navigate = useNavigate();
  const router = useRouter();
  const routeLocation = useRouterState({ select: (state) => state.location });
  const navigationEpoch = useRef(0);
  useEffect(() => {
    let href = router.state.location.href;
    return router.history.subscribe(({ location }) => {
      if (location.href !== href) navigationEpoch.current++;
      href = location.href;
    });
  }, [router]);
  const search = useSearch({ strict: false });
  const addressedThread = search.thread ?? "";
  const issue = routeThreadIssue(addressedThread, routeLocation.state);
  const currentThreadId = issue === "minted" ? "" : (issue ?? addressedThread);
  const draftHead = useReading<ThreadHead>(
    issue === "minted" ? { kind: "thread-head", thread: addressedThread } : null,
  );
  const liveHead = useRef(draftHead);
  liveHead.current = draftHead;
  useEffect(() => {
    if (!issue || issue === "minted") return;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({ ...previous, thread: issue }),
      replace: true,
    });
  }, [issue, navigate]);
  const store = useRouteOwner(() =>
    createChatPageStore({
      registry: appAtomRegistry,
      search: {
        ...search,
        mode: "mode" in search && typeof search.mode === "string" ? search.mode : "threads",
        patch: (partial, replace = false) =>
          navigate({
            to: ".",
            search: (previous: Record<string, unknown>) => ({ ...previous, ...partial }),
            replace,
          }),
      },
    }),
  );

  // The one `host-status` Reading; `previousOf` keeps the last good answer through a refetch.
  // Only the slice below: a poll that moved other host fields must not rebuild the context.
  const host = useHostStatusSlice((status) => {
    const info = previousOf(status);
    return {
      known: info !== undefined || status.state === "failed",
      failure: status.state === "failed" ? status.message : undefined,
      revit: info?.capabilities.revit,
      world: info?.world as WorkbenchContextValue["world"],
    };
  });
  const client = useMemo(() => harnessClient(config.origin), [config.origin]);
  const [threads, setThreads] = useState<StoredThreadSummary[]>([]);
  const rosterEpoch = useRef(0);
  const [draft, setDraft] = useState<HeadDraft>(EMPTY_HEAD);
  // Undefined until the human picks or clears: the draft then shows the sole user document, if any.
  const [chosenTarget, setDraftTarget] = useState<DocumentRequest | null>();
  const machine = machineOf(useMachine().reading);
  const draftTarget = useMemo(
    () => (chosenTarget === undefined ? soleUserDocument(machine) : chosenTarget),
    [chosenTarget, machine],
  );
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
    let fault: string | undefined;
    return client.summaries(
      (listed) => {
        rosterEpoch.current++;
        setThreads((current) => mergeThreadRoster(current, listed));
        // A fresh roster ends the list's own staleness, never another verb's complaint.
        setError((current) => (current === fault ? undefined : current));
      },
      (caught) => setError((fault = errorMessage(caught))),
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
  const loading = demo ? false : chatLoading(host.known, stream.pending);
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

  const creatingThread = useRef<{
    address: string;
    epoch: number;
    promise: Promise<string>;
  } | null>(null);
  /** Only an explicit create/send promotes a browser draft; one in-flight create owns its address. */
  const createThread = useCallback((): Promise<string> => {
    const source = router.state.location;
    if (demo)
      return Promise.reject(Error("Fixture threads are read-only; open a real draft to send."));
    const epoch = navigationEpoch.current;
    if (creatingThread.current)
      return creatingThread.current.address === source.href &&
        creatingThread.current.epoch === epoch
        ? creatingThread.current.promise
        : Promise.reject(
            Error("Another draft is being created; wait for its outcome before sending here."),
          );
    const from = source.search.thread ?? "";
    if (from !== addressedThread)
      return Promise.reject(Error("The draft address changed; read it again before sending."));
    if (from && routeThreadIssue(from, source.state) !== "minted")
      return Promise.reject(
        Error("This thread is not a locally issued draft; reopen its existing conversation."),
      );
    if (sendRefusal || !drafted)
      return Promise.reject(Error(sendRefusal ?? "no provider is ready"));
    if (from && draftHead.state !== "ready")
      return Promise.reject(
        Error("The draft target is not current; read it again before sending."),
      );
    const head = draftHead.state === "ready" ? draftHead.observation : null;
    let initialTarget = from && chosenTarget === undefined ? head!.defaultTarget : draftTarget;
    const current = () =>
      router.state.location.href === source.href &&
      navigationEpoch.current === epoch &&
      (!from ||
        (liveHead.current.state === "ready" &&
          liveHead.current.observation.revision === head!.revision));
    const promise = (async () => {
      if (source.search.target) {
        initialTarget = documentRequestSchema.parse(JSON.parse(source.search.target));
      }
      const created = await client.create(drafted.id);
      try {
        if (!current()) throw Error("The Place changed during creation.");
        if (initialTarget) {
          const displayLabel = threads.find(
            (thread) => targetKey(thread.head.defaultTarget) === targetKey(initialTarget),
          )?.head.displayLabel;
          const outcome = await client.target(created.id, {
            defaultTarget: initialTarget,
            revision: created.head.revision,
            displayLabel,
          });
          if (!outcome.ok) throw Error("The new thread target changed.");
        }
        if (draft.modelId && draft.modelId !== created.modelId)
          await client.model(created.id, draft.modelId);
        for (const [id, value] of Object.entries(draft.traits))
          await client.trait(created.id, id, value);
        if (!current()) throw Error("The Place changed during creation.");
        await store.actions.promoteThread(from, created.id, current);
        const promoted = router.state.location.href;
        const promotedEpoch = navigationEpoch.current;
        await refreshThreads();
        if (
          router.state.location.search.thread !== created.id ||
          router.state.location.href !== promoted ||
          navigationEpoch.current !== promotedEpoch
        )
          throw Error("The Place changed after promotion.");
        return created.id;
      } catch (caught) {
        throw Error(
          `Thread ${created.id} was created, but ${errorMessage(caught)} Open it from Threads to continue.`,
        );
      }
    })().finally(() => {
      creatingThread.current = null;
    });
    creatingThread.current = { address: source.href, epoch, promise };
    return promise;
  }, [
    client,
    addressedThread,
    chosenTarget,
    demo,
    draft,
    draftHead,
    draftTarget,
    drafted,
    router,
    sendRefusal,
    refreshThreads,
    store,
    threads,
  ]);

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
          await navigate({
            to: ".",
            search: (previous: Record<string, unknown>) => ({ ...previous, thread: undefined }),
          });
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

  // A thread the host does not know is the transcript's empty state, not a fault.
  const operationError =
    error ??
    (host.failure !== undefined ? host.failure : missingThread ? undefined : stream.error?.message);
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
      revit: host.revit,
      world: host.world,
      isRunning,
      operationError,
      sendPrompt,
      cancel: onThread((id) => client.cancel(id)),
      newThread: async (target) => {
        setDraftTarget(target);
        await navigate({
          to: ".",
          search: (previous: Record<string, unknown>) => ({ ...previous, thread: undefined }),
        });
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
      host,
      isRunning,
      loading,
      missingThread,
      sendRefusal,
      onThread,
      operationError,
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
