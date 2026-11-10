import type { ListSearch } from "@pe/agent-contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type CSSProperties,
} from "react";
import { useRouteSearchSlice } from "#/route/activity";
import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { NewThreadButton, ThreadsSidebar } from "#/chat/thread-palette";
import { useTranscript, useTranscriptAtom, useWorkbench } from "#/workbench/provider";
import {
  selectBreakdown,
  selectRunStatus,
  selectTitle,
  selectStarting,
  selectWaitingSeconds,
} from "@pe/agent-contracts/chat-state";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import {
  ChatCluster,
  ChatSituationHead,
  ComposerPickers,
  ComposerState,
  ComposerWork,
  useChatSituation,
} from "#/chat/composer-head";
import { PagePaletteButton } from "#/route/situation-marks";
import { PrimaryRouteControls, usePublishPagePalette } from "#/navigation/route-controls";
import { useSurfaceHost } from "#/navigation/surface-host";
import { Ledger } from "#/navigation/ledger";
import { LEDGER_PRESENTATIONS } from "#/navigation/ledger-model";
import { PaneActions } from "#/shell/pane-actions";

import type { ChatHandle } from "./owner-ports";
import { readThreadTarget } from "#/chat/thread-navigation";
import "#/workbench/lens.css";
import "./chat-shell.css";
import { CurrentThreadViewOwner } from "#/workbench/thread-view";
import { PaneErrorBoundary, PaneLoading } from "@pe/kit/lang/pane";
import { Work } from "@pe/kit/lang/work";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";
import { useThreadPresence } from "#/machine/os-notices";
import { routeAddress, routeAt } from "@pe/agent-contracts";

export type ChatShellProps = { target?: string; docked?: boolean };
export const ChatSurfaceProps = createContext<ChatShellProps>({});

/** A new thread is a draft until its first send; in the tray it replaces Activity meanwhile. */
function useNewThread() {
  const { store, newThread } = useWorkbench();
  return useCallback(
    (target?: Parameters<typeof newThread>[0]) => {
      store.actions.compose(true);
      return newThread(target);
    },
    [store, newThread],
  );
}

/** The route's threads pane, the one thread navigator. Its count and New go in the kernel's head. */
export function ThreadsDrawing({ ctx: handle }: { ctx: ChatHandle }) {
  const { docked = false } = useContext(ChatSurfaceProps);
  const {
    store,
    threads,
    rosterRead,
    providers,
    currentThreadId,
    forkThread,
    openThread,
    renameThread,
    deleteThread,
    updateThread,
  } = useWorkbench();
  const chatId = useTranscript((state) => state.id);
  const newThread = useNewThread();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sidebarAddress = routeAddress(routeAt(pathname) ?? "pea");
  const sidebarPage = useRouteSearchSlice((search) => {
    const page = sidebarAddress.read(search).page;
    return { threadSearch: page.threadSearch, threadSort: page.threadSort };
  });
  const threadListAddress = {
    scope: pathname,
    search: sidebarPage.threadSearch,
    sort: sidebarPage.threadSort,
    onChange: (threadSearch: ListSearch, threadSort: "recent" | "title" | "") => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          ...sidebarAddress.write({ threadSearch, threadSort }),
        }),
      });
    },
  };
  const situation = useChatSituation(handle);
  // The live inventory decides what a saved target is: a request that may be closed.
  const sidebarThreads = useMemo(
    () => threads.map((thread) => readThreadTarget(thread, situation.inventory)),
    [threads, situation.inventory],
  );
  // N3: the thread list is the one thread navigator. Its "palette" is its own search, focused in
  // place, never a second list.
  const [searchSerial, setSearchSerial] = useState(0);
  const findThread = () => setSearchSerial((serial) => serial + 1);
  usePublishPagePalette("chat", false, (open) => open && findThread());
  return (
    <div data-surface="artifact" className="flex min-h-0 flex-1 flex-col">
      {!docked && (
        <PrimaryRouteControls route="chat" slot="palette">
          <PagePaletteButton open={findThread} />
        </PrimaryRouteControls>
      )}
      <PaneActions pane="threads">
        <small className="t-small text-ink-mute">{rosterRead ? threads.length : "…"}</small>
        <Button label="New thread" onClick={() => void newThread()}>
          new
        </Button>
      </PaneActions>
      <ThreadsSidebar
        // A thread is a route attention place: its id is the place (ADR 0035 rule 9).
        selected={handle.selection.read().map((item) => item.id)}
        onSelection={(selected) =>
          handle.selection.set(selected.map((id) => ({ kind: "focus", id })))
        }
        primary
        reading={!rosterRead}
        searchSerial={searchSerial}
        address={threadListAddress}
        threads={sidebarThreads}
        providers={providers.list ?? []}
        currentThreadId={currentThreadId || chatId}
        onSelect={openThread}
        onWork={(id, route, resumed, closed) =>
          void store.actions.openWork(id, route, resumed, closed)
        }
        onFork={(id, providerId) => {
          // SHIM: S gap 9; replace this Workbench fork callback with the typed host command.
          void forkThread(providerId, id);
        }}
        onRename={(id, title) => void renameThread(id, title)}
        onDelete={async (id) => {
          if (await deleteThread(id)) store.actions.forgetThread(id);
        }}
        onUpdate={updateThread}
        onNewTarget={(target) => void newThread(target)}
      />
    </div>
  );
}

/** The route's chat pane: the transcript and composer, or the tray's Activity ledger. */
export function ChatDrawing({ ctx }: { ctx: ChatHandle }) {
  const props = useContext(ChatSurfaceProps);
  const registry = useContext(RegistryContext);
  const { currentThreadId, turn } = useWorkbench();
  return (
    <CurrentThreadViewOwner threadKey={currentThreadId} registry={registry} turn={turn}>
      <ChatSurface {...props} handle={ctx} />
    </CurrentThreadViewOwner>
  );
}

function ChatSurface({ target, docked = false, handle }: ChatShellProps & { handle: ChatHandle }) {
  const columnRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const column = columnRef.current;
    const composer = composerRef.current;
    if (!column || !composer) return;
    const measure = () => {
      if (composer.offsetHeight > 0)
        column.style.setProperty("--chat-composer-height", `${composer.offsetHeight}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, []);
  const compact = useSurfaceHost().shell.mount === "compact";
  const {
    store,
    bodyAtom,
    loading,
    threads,
    currentThreadId,
    prompt,
    turnFailure,
    operationError,
    missingThread,
  } = useWorkbench();
  // The tray's Activity view: with no thread in the address, the body is the open-work ledger.
  const addressedThread = useRouterState({
    select: (state) => (state.location.search as { thread?: string }).thread,
  });
  // "New thread" in the tray: no address would show Activity again, so the draft is its own state
  // until the first send addresses the thread it creates.
  const composing = useAtomValue(store.atoms.composing);
  const deletedThreads = useAtomValue(store.atoms.deletedThreads);
  const deletedThreadIds = useMemo(() => new Set(deletedThreads), [deletedThreads]);
  useEffect(() => {
    if (addressedThread) store.actions.compose(false);
  }, [addressedThread, store]);
  useEffect(() => {
    // The bank keeps hidden composers; the draft's is the one laid out.
    if (composing)
      [...(composerRef.current?.querySelectorAll("textarea") ?? [])]
        .find((area) => area.offsetParent !== null)
        ?.focus();
  }, [composing]);
  const activity = compact && !addressedThread && !composing;
  const newThread = useNewThread();
  const chatAtom = useTranscriptAtom();
  const chat = useTranscript((state) => ({
    title: selectTitle(state),
    breakdown: selectBreakdown(state),
    runStatus: selectRunStatus(state),
    silentFor: selectWaitingSeconds(state),
    starting: selectStarting(state),
  }));
  useThreadPresence(activity ? null : currentThreadId);
  const situation = useChatSituation(handle);

  // N6: a thread switch keeps the last read transcript, inert and dimmed under a progress mark,
  // until the next body reads. The boundary turns over with the body it shows, so an old failure
  // still cannot mask the new thread.
  const body = useAtomValue(bodyAtom);
  const shownRef = useRef({ thread: currentThreadId, bodyAtom, chatAtom });
  if (body._tag !== "Initial" || shownRef.current.thread === currentThreadId)
    shownRef.current = { thread: currentThreadId, bodyAtom, chatAtom };
  const shown = shownRef.current;
  const switching = shown.thread !== currentThreadId;
  const retryBody = useAtomRefresh(bodyAtom);

  const { runStatus, silentFor, breakdown } = chat;
  const status = {
    text: turnFailure
      ? "failed"
      : loading
        ? "loading thread state"
        : runStatus === "waiting"
          ? "waiting for you"
          : chat.starting
            ? "starting the harness"
            : silentFor !== undefined
              ? `waiting on the model for ${silentFor} s`
              : runStatus === "running"
                ? "running"
                : "ready",
    caution: turnFailure !== undefined,
    detail: operationError ?? turnFailure,
  };
  const title =
    chat.title ||
    threads.find((thread) => thread.id === currentThreadId)?.title ||
    // I1: no thread yet is the draft the first send creates.
    (currentThreadId ? "thread" : "New thread");
  return (
    <div
      data-chat="surface"
      data-route-mount="chat"
      className="flex min-h-0 min-w-0 flex-1 flex-col font-sans text-ink"
    >
      {!docked && (
        <PrimaryRouteControls route="chat" slot="situation">
          <ChatSituationHead handle={handle} situation={situation} status={status} />
        </PrimaryRouteControls>
      )}
      {activity ? (
        <Ledger
          presentation={LEDGER_PRESENTATIONS.tray}
          head={
            <p className="m-0 flex justify-end px-2 py-1 hairline-b">
              <Button label="Start a new Pea thread" onClick={() => void newThread()}>
                New thread
              </Button>
            </p>
          }
        />
      ) : (
        <div data-chat-column="" ref={columnRef} className="chat-column min-h-0 min-w-0 flex-1">
          {/* The thread is this pane's subject: its name and verbs ride the kernel's pane head. */}
          <PaneActions pane="chat">
            <span data-slot="pane-subject" className="min-w-0 truncate">
              {switching ? "reading" : title}
            </span>
            <ChatCluster handle={handle} situation={situation} />
          </PaneActions>
          <div
            data-chat-transcript=""
            data-switching={switching ? "" : undefined}
            aria-busy={switching}
            className="min-h-0 min-w-0"
          >
            <Work pending={switching} label="opening thread…" />
            <PaneErrorBoundary key={shown.thread} what="thread" onRetry={retryBody}>
              <Suspense fallback={<PaneLoading what="thread" />}>
                {missingThread ? (
                  <div className="grid min-h-[60vh] place-content-center justify-items-center gap-3 px-6 text-center">
                    <EmptyState story="scope" exit="start a new thread, or pick one on the left">
                      no such thread on this host
                    </EmptyState>
                    <span className="face-mono t-small text-ink-2">{currentThreadId}</span>
                    <NewThreadButton onNew={() => void newThread()} />
                  </div>
                ) : (
                  <div inert={switching} className="contents">
                    <ThreadBody bodyAtom={shown.bodyAtom} stateAtom={shown.chatAtom} />
                  </div>
                )}
              </Suspense>
            </PaneErrorBoundary>
          </div>
          <div data-chat-composer="" ref={composerRef}>
            <ComposerBank
              currentThreadId={addressedThread ?? currentThreadId}
              deletedThreadIds={deletedThreadIds}
              prompt={prompt}
              handle={handle}
              pickers={<ComposerPickers situation={situation} urlTarget={target} />}
              state={<ComposerState situation={situation} />}
              work={<ComposerWork situation={situation} />}
              refusal={situation.head.refusal ?? status.detail}
            />
          </div>
          {/* The context bar shares the lens's side column at the composer's height. */}
          <ContextBar breakdown={breakdown} />
        </div>
      )}
    </div>
  );
}

/** Context-window use from the harness's latest `usage_update`; an empty track until one arrives. */
function ContextBar({ breakdown }: { breakdown: ReturnType<typeof selectBreakdown> }) {
  const used = breakdown?.totalTokens ?? 0;
  const size = breakdown?.contextWindow ?? 0;
  const share = size > 0 ? Math.min(1, used / size) : 0;
  const hint = breakdown
    ? `context ${used.toLocaleString()} of ${size.toLocaleString()} tokens (${Math.round(share * 100)}%)`
    : "context use not reported yet";
  return (
    <TooltipHint content={hint}>
      <div
        data-chat-context=""
        role="meter"
        aria-label="Context window"
        aria-valuemin={0}
        aria-valuemax={size || undefined}
        aria-valuenow={breakdown ? used : undefined}
        aria-valuetext={hint}
        style={{ "--context-share": share } as CSSProperties}
      />
    </TooltipHint>
  );
}
