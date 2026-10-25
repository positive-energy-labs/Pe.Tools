import type { ListSearch } from "@pe/agent-contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouteSearchSlice } from "#/route/activity";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { NewThreadButton, ThreadsSidebar, ThreadPane } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { MODES, type Mode } from "#/workbench/depth";
import { useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
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
import { RouteShell, useRoute } from "#/route";
import { appAtomRegistry } from "#/route/route-owner";
import { useScopeKeys } from "@pe/kit/keys";
import { PagePaletteButton } from "#/route/situation-marks";
import { PrimaryRouteControls, usePublishPagePalette } from "#/navigation/route-controls";
import { useSurfaceHost } from "#/navigation/surface-host";
import { Ledger } from "#/navigation/ledger";
import { LEDGER_PRESENTATIONS } from "#/navigation/ledger-model";
import { chatManifest } from "#/chat/manifest";
import { readThreadTarget } from "#/chat/thread-navigation";
import "#/workbench/lens.css";
import "./chat-shell.css";
import { CurrentThreadViewOwner } from "#/workbench/thread-view";
import { Pane, PaneSplit, type PaneSide } from "@pe/kit/lang/pane";
import { Surface as PageSurface } from "@pe/kit/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";
import { useThreadPresence } from "#/machine/os-notices";
import { routeAddress, routeAt } from "@pe/agent-contracts";

type ChatShellProps = { target?: string; docked?: boolean };

/** Whether ThreadsSplit is drawing the thread sidebar open beside Pea's column right now. */
const SidebarShown = createContext(false);

/** The thread sidebar's default width, and its folded rail. */
const SIDEBAR = 300;
/** Pea's floor in px: the chat column's reading measure (`--chat-measure` in chat-shell.css: 76ch
 *  of the prose face at 0.577em a character, plus both gutters) between its two side lanes (lens
 *  and context bar). Read from the same tokens, so density moves it too. */
function peaFloor(root: Element = document.documentElement) {
  const token = (name: string) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  const gutter = token("--gutter");
  const measure = token("--type-prose-size") * 0.577 * 76 + gutter * 2;
  return Math.ceil(measure + (token("--control-h") + gutter * 2) * 2);
}

export const ChatShell = memo(function ChatShell(props: ChatShellProps) {
  return <CurrentThreadChatSurface {...props} />;
});

function CurrentThreadChatSurface(props: ChatShellProps) {
  const { currentThreadId, turn } = useWorkbench();
  return (
    <CurrentThreadViewOwner threadKey={currentThreadId} registry={appAtomRegistry} turn={turn}>
      <ChatSurface {...props} />
    </CurrentThreadViewOwner>
  );
}

function ChatSurface({ target, docked = false }: ChatShellProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const column = columnRef.current;
    const composer = composerRef.current;
    if (!column || !composer) return;
    const measure = () =>
      column.style.setProperty("--chat-composer-height", `${composer.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    measure();
    return () => observer.disconnect();
  }, []);
  const compact = useSurfaceHost().shell.mount === "compact";
  // The tray's Activity view: with no thread in the address, the body is the open-work ledger.
  const addressedThread = useRouterState({
    select: (state) => (state.location.search as { thread?: string }).thread,
  });
  // "New thread" in the tray: no address would show Activity again, so the draft is its own state
  // until the first send addresses the thread it creates.
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (addressedThread) setComposing(false);
  }, [addressedThread]);
  useEffect(() => {
    // The bank keeps hidden composers; the draft's is the one laid out.
    if (composing)
      [...(composerRef.current?.querySelectorAll("textarea") ?? [])]
        .find((area) => area.offsetParent !== null)
        ?.focus();
  }, [composing]);
  const activity = compact && !addressedThread && !composing;
  const {
    store,
    chat,
    bodyAtom,
    loading,
    threads,
    rosterRead,
    providers,
    currentThreadId,
    prompt,
    turnFailure,
    isRunning,
    operationError,
    sendPrompt,
    cancel,
    newThread: startThread,
    forkThread,
    sendRefusal,
    missingThread,
    draftTarget,
    openThread,
    renameThread,
    deleteThread,
    updateThread,
  } = useWorkbench();
  useThreadPresence(activity ? null : currentThreadId);
  const newThread = useCallback(
    (target?: Parameters<typeof startThread>[0]) => {
      setComposing(true);
      return startThread(target);
    },
    [startThread],
  );
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
  const urlMode = useRouterState({ select: (state) => state.location.search.mode });
  const [dockMode, setDockMode] = useState<Mode>("threads");
  const mode = docked ? dockMode : urlMode === "world" ? "world" : "threads";
  const setMode = (next: Mode) => {
    if (docked) setDockMode(next);
    else
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({ ...previous, mode: next }),
      });
  };
  // The route, re-declared with this thread and the provider's verbs bound.
  const manifest = useMemo(
    () =>
      chatManifest({
        thread: currentThreadId,
        ready: !loading,
        running: isRunning,
        send: sendPrompt,
        cancel,
        newThread: () => newThread(),
        forkThread: () => forkThread(),
        sendRefusal,
        promptCapabilities: chat.promptCapabilities,
        providerName: chat.providerName,
        draftTarget,
      }),
    [
      currentThreadId,
      loading,
      isRunning,
      sendPrompt,
      cancel,
      newThread,
      forkThread,
      sendRefusal,
      chat.promptCapabilities,
      chat.providerName,
      draftTarget,
    ],
  );
  // The handle is owned here, not inside the shell: Chat has no route head, and its composer
  // head is the Situation, which needs the same handle the shell's chords run through.
  const handle = useRoute(manifest, { thread: currentThreadId, url: false });
  const situation = useChatSituation(handle);
  // The live inventory decides what a saved target is: a request that may be closed.
  const sidebarThreads = useMemo(
    () => threads.map((thread) => readThreadTarget(thread, situation.inventory)),
    [threads, situation.inventory],
  );
  const handleRenameThread = (id: string, title: string) => void renameThread(id, title);
  const [deletedThreadIds, setDeletedThreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const handleDeleteThread = async (id: string) => {
    if (await deleteThread(id)) setDeletedThreadIds((previous) => new Set([...previous, id]));
  };
  const threadFold = useAtomValue(store.atoms.threadFold);
  // N3: the thread list is the one thread navigator. Its "palette" is its own search, revealed
  // and focused in place, never a second list.
  const [searchSerial, setSearchSerial] = useState(0);
  const findThread = () => {
    store.actions.revealThreads();
    setSearchSerial((serial) => serial + 1);
  };
  usePublishPagePalette(handle.manifest.key, false, (open) => open && findThread());

  // N6: a thread switch keeps the last read transcript, inert and dimmed under a progress mark,
  // until the next body reads. The boundary turns over with the body it shows, so an old failure
  // still cannot mask the new thread.
  const body = useAtomValue(bodyAtom);
  const shownRef = useRef({ thread: currentThreadId, bodyAtom, chat });
  if (body._tag !== "Initial" || shownRef.current.thread === currentThreadId)
    shownRef.current = { thread: currentThreadId, bodyAtom, chat };
  const shown = shownRef.current;
  const switching = shown.thread !== currentThreadId;

  // Context gauges (cap + OM meters) ride beside the composer now, so the cache view is derived
  // here instead of inside the Lens. userTurns gates the diff baseline (advances on each send).
  const breakdown = useMemo(() => selectBreakdown(chat), [chat]);
  const userTurns = useMemo(
    () => chat.events.filter((event) => event.kind === "prompt").length,
    [chat.events],
  );
  const cache = useCacheView(breakdown, userTurns);
  const retryBody = useAtomRefresh(bodyAtom);

  // Surface chords, not manifest actions: they move Page state and never refuse. They bind on
  // whatever scope node the chat surface sits in, so help lists them beside the route's chords.
  useScopeKeys([
    {
      hotkey: "Mod+K",
      callback: findThread,
      options: { ignoreInputs: false },
      label: "find a thread",
      says: "focus the thread list's search: switch what this page shows",
    },
    ...(["Mod+1", "Mod+2"] as const).map((hotkey, i) => ({
      hotkey,
      callback: () => setMode(MODES[i]!),
      label: `${MODES[i]} mode`,
      says: `switch the chat to ${MODES[i]}`,
    })),
  ]);

  const runStatus = selectRunStatus(chat);
  const silentFor = selectWaitingSeconds(chat);
  const status = {
    text: turnFailure
      ? "failed"
      : loading
        ? "loading thread state"
        : runStatus === "waiting"
          ? "waiting for you"
          : selectStarting(chat)
            ? "starting the harness"
            : silentFor !== undefined
              ? `waiting on the model for ${silentFor} s`
              : runStatus === "running"
                ? "running"
                : "ready",
    caution: turnFailure !== undefined,
    detail: operationError ?? turnFailure,
  };
  const chatColumn = (
    <div data-chat-column="" ref={columnRef} className="chat-column min-h-0 min-w-0 flex-1">
      <div
        data-chat-transcript=""
        data-switching={switching ? "" : undefined}
        aria-busy={switching}
        className="min-h-0 min-w-0"
      >
        <Pane
          scroll="clip"
          flush
          id="transcript"
          name
          titleAlign="center"
          meta={handle.demo ? "Fixture" : switching ? "reading" : undefined}
          title={
            selectTitle(chat) ||
            threads.find((thread) => thread.id === currentThreadId)?.title ||
            // I1: no thread yet is the draft the first send creates.
            (currentThreadId ? "thread" : "New thread")
          }
          actions={<ChatCluster handle={handle} situation={situation} />}
          boundaryKey={shown.thread}
          onRetry={retryBody}
        >
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
              <ThreadBody bodyAtom={shown.bodyAtom} state={shown.chat} />
            </div>
          )}
        </Pane>
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
      {/* The context bar shares the lens's side column at the composer's height. Docked beside a
          plugin while the thread sidebar is actually drawn open, it takes the left column. */}
      <ContextBar breakdown={breakdown} docked={Boolean(docked)} />
    </div>
  );

  const threadPane = (
    <ThreadPane
      mode={mode}
      setMode={setMode}
      count={rosterRead ? threads.length : "…"}
      onNew={() => {
        void newThread();
        store.actions.revealChat();
      }}
    >
      {mode === "threads" ? (
        <ThreadsSidebar
          primary
          reading={!rosterRead}
          searchSerial={searchSerial}
          address={threadListAddress}
          threads={sidebarThreads}
          providers={providers.list ?? []}
          currentThreadId={currentThreadId || chat.id}
          onSelect={(id) => {
            openThread(id);
            store.actions.revealChat();
          }}
          onWork={(id, route, resumed, closed) => {
            void store.actions.openWork(id, route, resumed, closed);
            store.actions.revealChat();
          }}
          onFork={(id, providerId) => void forkThread(providerId, id)}
          onRename={handleRenameThread}
          onDelete={handleDeleteThread}
          onUpdate={updateThread}
          onNewTarget={(target) => {
            void newThread(target);
            store.actions.revealChat();
          }}
        />
      ) : (
        <SessionStrip breakdown={breakdown} cache={cache} sendNumber={userTurns} />
      )}
    </ThreadPane>
  );

  return (
    <main
      data-chat="surface"
      data-mode={mode}
      className="size-full min-h-0 min-w-0 font-sans text-ink"
    >
      {!docked && (
        <PrimaryRouteControls route="chat" slot="palette">
          <PagePaletteButton open={findThread} />
        </PrimaryRouteControls>
      )}
      {!docked && (
        <PrimaryRouteControls route="chat" slot="situation">
          <ChatSituationHead handle={handle} situation={situation} status={status} />
        </PrimaryRouteControls>
      )}
      {/* The route shell owns the chords and the remaining-height conversation column. Chat has
          no generic route head: its global Situation observes the composer owners. */}
      <RouteShell manifest={manifest} handle={handle} situation={<></>}>
        <PageSurface>
          <ThreadsSplit
            collapsed={threadFold}
            onCollapsedChange={store.actions.setThreadFold}
            threads={threadPane}
          >
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
              chatColumn
            )}
          </ThreadsSplit>
        </PageSurface>
      </RouteShell>
    </main>
  );
}

/** Context-window use from the harness's latest `usage_update`; an empty track until one arrives. */
function ContextBar({
  breakdown,
  docked,
}: {
  breakdown: ReturnType<typeof selectBreakdown>;
  docked: boolean;
}) {
  const shown = useContext(SidebarShown);
  const side = docked && shown ? "start" : "end";
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
        data-side={side}
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

/** The split owns fitting and exclusive reveal; both sides retain their contents behind rails. */
export function ThreadsSplit({
  collapsed,
  onCollapsedChange,
  threads,
  children,
}: {
  collapsed: PaneSide | null;
  onCollapsedChange: (side: PaneSide | null) => void;
  threads: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarShown.Provider value={collapsed !== "start"}>
      <PaneSplit
        axis="horizontal"
        grow
        resize={{
          target: "start",
          defaultSize: SIDEBAR,
          minSize: 240,
          minOtherSize: peaFloor(),
          persist: "pe.sideWidth",
          collapse: {
            collapsed,
            onCollapsedChange,
            start: { title: "threads" },
            end: { title: "chat" },
          },
        }}
        start={threads}
        end={children}
      />
    </SidebarShown.Provider>
  );
}
