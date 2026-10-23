import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { ModeDial } from "#/chat/mode-dial";
import { NewThreadButton, ThreadDialog, ThreadsSidebar } from "#/chat/thread-palette";
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
import { Menu } from "lucide-react";
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
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface as PageSurface } from "#/components/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";
import { Dialog, DialogContent, DialogTitle } from "#/components/lang/dialog";
import { useThreadPresence } from "#/machine/os-notices";
import { routeAddress, routeAt } from "@pe/agent-contracts";

type ChatShellProps = { target?: string; docked?: boolean };

export function ChatShell(props: ChatShellProps) {
  return <CurrentThreadChatSurface {...props} />;
}

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
    if (composing) composerRef.current?.querySelector("textarea")?.focus();
  }, [composing]);
  const activity = compact && !addressedThread && !composing;
  const {
    store,
    chat,
    bodyAtom,
    loading,
    threads,
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
  const location = useRouterState({ select: (state) => state.location });
  const sidebarAddress = routeAddress(routeAt(location.pathname) ?? "pea");
  const sidebarPage = sidebarAddress.read(location.search).page;
  const threadListAddress = {
    query: sidebarPage.threadQuery,
    sort: sidebarPage.threadSort,
    onChange: (threadQuery: string, threadSort: "recent" | "title" | "") => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          ...sidebarAddress.write({ threadQuery, threadSort }),
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
  const [viewportNarrow, setViewportNarrow] = useState(false);
  const narrow = docked || compact || viewportNarrow;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const changed = () => {
      setViewportNarrow(media.matches);
      if (docked || compact || media.matches) store.actions.setSideOpen(false);
    };
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [docked, compact, store]);
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
  const paletteOpen = useAtomValue(store.atoms.paletteOpen);
  usePublishPagePalette(handle.manifest.key, paletteOpen, store.actions.setPaletteOpen);
  const sideOpen = useAtomValue(store.atoms.sideOpen);

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
  const togglePagePalette = () => store.actions.setPaletteOpen((open) => !open);
  useScopeKeys([
    {
      hotkey: "Mod+K",
      callback: togglePagePalette,
      options: { ignoreInputs: false },
      label: "palette",
      says: "open or close the Do palette",
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
      <div data-chat-transcript="" className="min-h-0 min-w-0">
        <Pane
          scroll="clip"
          flush
          id="transcript"
          name
          titleAlign="center"
          meta={handle.demo ? "Fixture" : undefined}
          title={
            selectTitle(chat) ||
            threads.find((thread) => thread.id === currentThreadId)?.title ||
            "thread"
          }
          leadingActions={
            narrow ? (
              <Button
                icon={Menu}
                label="Open threads"
                onClick={() => store.actions.setSideOpen(true)}
              />
            ) : null
          }
          actions={<ChatCluster handle={handle} situation={situation} />}
          boundaryKey={currentThreadId}
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
            <ThreadBody bodyAtom={bodyAtom} state={chat} />
          )}
        </Pane>
      </div>
      <div data-chat-composer="" ref={composerRef}>
        <ComposerBank
          currentThreadId={currentThreadId}
          deletedThreadIds={deletedThreadIds}
          prompt={prompt}
          handle={handle}
          pickers={<ComposerPickers situation={situation} urlTarget={target} />}
          state={<ComposerState situation={situation} />}
          work={<ComposerWork situation={situation} />}
          refusal={situation.head.refusal ?? status.detail}
        />
      </div>
    </div>
  );

  return (
    <main
      data-chat="surface"
      data-mode={mode}
      className="size-full min-h-0 min-w-0 font-sans text-ink"
    >
      {!docked && (
        <PrimaryRouteControls route="chat" slot="palette">
          <PagePaletteButton open={togglePagePalette} />
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
          <PaneSplit
            axis="horizontal"
            grow
            hide={narrow ? "start" : undefined}
            resize={
              narrow
                ? undefined
                : {
                    target: "start",
                    defaultSize: 300,
                    minSize: 240,
                    persist: "pe.sideWidth",
                    collapse: {
                      collapsed: !sideOpen,
                      onCollapsedChange: (collapsed) => store.actions.setSideOpen(!collapsed),
                      collapsedSize: 32,
                      title: "threads",
                    },
                  }
            }
            start={
              <Pane
                scroll="clip"
                id="threads"
                ground="artifact"
                title="threads"
                meta={threads.length}
                tabs={<ModeDial mode={mode} setMode={setMode} count={threads.length} />}
              >
                {mode === "threads" ? (
                  <ThreadsSidebar
                    address={threadListAddress}
                    threads={sidebarThreads}
                    providers={providers.list ?? []}
                    currentThreadId={currentThreadId || chat.id}
                    onSelect={openThread}
                    onNew={() => void newThread()}
                    onFork={(id, providerId) => void forkThread(providerId, id)}
                    onRename={handleRenameThread}
                    onDelete={handleDeleteThread}
                    onSearch={() => store.actions.setPaletteOpen(true)}
                    onUpdate={updateThread}
                    onNewTarget={(target) => void newThread(target)}
                  />
                ) : (
                  <SessionStrip breakdown={breakdown} cache={cache} sendNumber={userTurns} />
                )}
              </Pane>
            }
            end={
              activity ? (
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
              )
            }
          />
        </PageSurface>
      </RouteShell>

      {narrow && sideOpen ? (
        <Dialog open onOpenChange={(open) => store.actions.setSideOpen(open)}>
          <DialogContent>
            <DialogTitle>Threads</DialogTitle>
            <ModeDial mode={mode} setMode={setMode} count={threads.length} />
            <div className="h-[75dvh] min-h-0 min-w-0">
              {mode === "threads" ? (
                <ThreadsSidebar
                  address={threadListAddress}
                  threads={sidebarThreads}
                  providers={providers.list ?? []}
                  currentThreadId={currentThreadId || chat.id}
                  onSelect={(id) => {
                    openThread(id);
                    store.actions.setSideOpen(false);
                  }}
                  onNew={() => {
                    void newThread();
                    store.actions.setSideOpen(false);
                  }}
                  onFork={(id, providerId) => void forkThread(providerId, id)}
                  onRename={handleRenameThread}
                  onDelete={handleDeleteThread}
                  onSearch={() => store.actions.setPaletteOpen(true)}
                  onUpdate={updateThread}
                  onNewTarget={(target) => {
                    void newThread(target);
                    store.actions.setSideOpen(false);
                  }}
                />
              ) : (
                <SessionStrip breakdown={breakdown} cache={cache} sendNumber={userTurns} />
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      <ThreadDialog
        threads={sidebarThreads}
        providers={providers.list ?? []}
        currentThreadId={currentThreadId || chat.id}
        open={paletteOpen}
        onOpenChange={store.actions.setPaletteOpen}
        onSelect={openThread}
        onNew={() => void newThread()}
        onFork={(id, providerId) => void forkThread(providerId, id)}
        onRename={handleRenameThread}
        onDelete={handleDeleteThread}
        onUpdate={updateThread}
        onNewTarget={(target) => void newThread(target)}
      />
    </main>
  );
}
