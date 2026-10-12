import { useEffect, useMemo, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { ModeDial } from "#/chat/mode-dial";
import { NewThreadButton, ThreadDialog, ThreadsSidebar } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
import {
  selectBreakdown,
  selectRunStatus,
  selectTitle,
  selectWaitingSeconds,
} from "#/workbench/chat-state";
import { EmptyState } from "#/components/lang/empty";
import { Button } from "#/components/lang/button";
import { Menu, X } from "lucide-react";
import { chatPluginTitle, type ChatPluginRoute } from "#/workbench/chat-plugins";
import { useChatPluginHost } from "#/workbench/route-panes";
import {
  ChatCluster,
  ComposerControls,
  ComposerWork,
  useChatSituation,
} from "#/chat/composer-head";
import { RouteShell, useRoute } from "#/route";
import { appAtomRegistry } from "#/route/route-owner";
import { useScopeKeys } from "#/route/keys";
import { chatManifest } from "#/chat/manifest";
import { readThreadTarget } from "#/chat/thread-navigation";
import "#/workbench/lens.css";
import { CurrentThreadViewOwner } from "#/workbench/thread-view";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface as PageSurface } from "#/components/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";
import { Dialog, DialogContent, DialogTitle } from "#/components/lang/dialog";

type Plugin = { plugin?: ChatPluginRoute; focus?: string; target?: string };

export function ChatShell(props: Plugin) {
  return <CurrentThreadChatSurface {...props} />;
}

function CurrentThreadChatSurface(props: Plugin) {
  const { currentThreadId, turn, patchThreadView } = useWorkbench();
  return (
    <CurrentThreadViewOwner
      threadKey={currentThreadId}
      registry={appAtomRegistry}
      turn={turn}
      patch={patchThreadView}
    >
      <ChatSurface {...props} />
    </CurrentThreadViewOwner>
  );
}

function ChatSurface({ plugin, focus, target }: Plugin) {
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
    newThread,
    forkThread,
    newRefusal,
    missingThread,
    draftTarget,
    openThread,
    renameThread,
    deleteThread,
    updateThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const changed = () => {
      setNarrow(media.matches);
      if (media.matches) store.actions.setSideOpen(false);
    };
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [store]);
  // The route, re-declared with this thread and the provider's verbs bound.
  const manifest = useMemo(
    () =>
      chatManifest({
        thread: currentThreadId,
        ready: !loading,
        running: isRunning,
        send: (input) => sendPrompt(input.text, input.attachments),
        cancel,
        newThread: () => newThread(),
        forkThread: () => forkThread(),
        newRefusal,
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
      newRefusal,
      chat.promptCapabilities,
      chat.providerName,
      draftTarget,
    ],
  );
  // The handle is owned here, not inside the shell: Chat has no route head, and its composer
  // head is the Situation, which needs the same handle the shell's chords run through.
  const handle = useRoute(manifest);
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
  const sideOpen = useAtomValue(store.atoms.sideOpen);
  const pluginOpen = useAtomValue(store.atoms.pluginOpen);
  useEffect(() => {
    if (plugin) store.actions.setPluginOpen(true);
  }, [plugin, store]);
  const planIntent = useAtomValue(store.atoms.planIntent);
  const intent = useMemo(
    () =>
      planIntent
        ? {
            route: planIntent.route,
            take: () => store.actions.takePlan(planIntent.route),
            refused: (message: string) => store.actions.refusePlan(planIntent.route, message),
          }
        : null,
    [planIntent, store],
  );
  const focusPath = parseFocus(focus);
  const chrome = plugin ? (
    <>
      {focusPath ? (
        <Button
          label="Show the whole Work"
          reason="Show the whole Work"
          onClick={() => store.actions.setPlugin(plugin)}
        >
          <span className="face-mono">{focusPath.join(" › ")}</span> <X />
        </Button>
      ) : null}
      <Button label="Close workspace" icon={X} onClick={() => store.actions.setPlugin(undefined)} />
    </>
  ) : null;
  const host = useChatPluginHost(plugin, currentThreadId, intent, focusPath, pluginOpen, chrome);

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
      callback: () => store.actions.setPaletteOpen((open) => !open),
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
          : silentFor !== undefined
            ? `waiting on the model for ${silentFor} s`
            : runStatus === "running"
              ? "running"
              : "ready",
    caution: turnFailure !== undefined,
    detail: operationError ?? turnFailure,
  };
  const chatColumn = (
    <div
      data-chat-column=""
      className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]"
    >
      <div className="min-h-0 min-w-0 flex-1">
        <Pane
          scroll="clip"
          flush
          id="transcript"
          name
          meta={handle.demo ? "Fixture" : undefined}
          title={
            selectTitle(chat) ||
            threads.find((thread) => thread.id === currentThreadId)?.title ||
            "thread"
          }
          actions={
            <>
              {narrow ? (
                <Button
                  icon={Menu}
                  label="Open threads"
                  onClick={() => store.actions.setSideOpen(true)}
                />
              ) : null}
              <ChatCluster handle={handle} situation={situation} />
            </>
          }
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
      <ComposerBank
        currentThreadId={currentThreadId}
        deletedThreadIds={deletedThreadIds}
        prompt={prompt}
        handle={handle}
        controls={
          <ComposerControls
            handle={handle}
            situation={situation}
            status={status}
            urlTarget={target}
          />
        }
        work={<ComposerWork situation={situation} status={status} />}
      />
    </div>
  );

  return (
    <main
      data-chat="surface"
      data-mode={mode}
      data-plugin={plugin}
      className="size-full min-h-0 min-w-0 font-sans text-ink"
    >
      {/* The route shell owns the chords and the remaining-height conversation column. Chat has
          no route head: the Situation is drawn in the composer (`ComposerControls`), so the shell draws
          none of its own. */}
      <RouteShell manifest={manifest} handle={handle} situation={<></>}>
        <PageSurface>
          <PaneSplit
            axis="horizontal"
            grow
            hide={narrow ? "start" : undefined}
            resize={{
              target: "start",
              defaultSize: 300,
              minSize: 240,
              persist: "pe.sideWidth",
              collapse: {
                collapsed: !sideOpen,
                onCollapsedChange: (collapsed) => store.actions.setSideOpen(!collapsed),
                collapsedSize: 40,
                title: "threads",
              },
            }}
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
              <PaneSplit
                axis="horizontal"
                grow
                resize={{
                  target: "end",
                  defaultSize: 640,
                  minSize: 480,
                  persist: "pe.pluginWidth",
                  collapse: {
                    collapsed: !plugin || !pluginOpen,
                    onCollapsedChange: (collapsed) => store.actions.setPluginOpen(!collapsed),
                    collapsedSize: 40,
                    title: plugin ? chatPluginTitle(plugin) : undefined,
                  },
                }}
                start={chatColumn}
                end={
                  plugin ? (
                    <Pane flush id="plugin">
                      <div ref={host.slot} className="contents" />
                    </Pane>
                  ) : null
                }
              />
            }
          />
        </PageSurface>
      </RouteShell>

      {host.kept}
      <Dialog open={narrow && sideOpen} onOpenChange={(open) => store.actions.setSideOpen(open)}>
        <DialogContent>
          <DialogTitle>Threads</DialogTitle>
          <div className="h-[75dvh] min-h-0 min-w-0">
            <ThreadsSidebar
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
          </div>
        </DialogContent>
      </Dialog>
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

/** The group path the drill-in scoped the pane to: canonical JSON of the path, in the Chat URL. */
function parseFocus(focus: string | undefined): string[] | null {
  if (!focus) return null;
  try {
    const path: unknown = JSON.parse(focus);
    return Array.isArray(path) && path.length && path.every((part) => typeof part === "string")
      ? path
      : null;
  } catch {
    return null;
  }
}
