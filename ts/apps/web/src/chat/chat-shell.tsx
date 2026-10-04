import { useEffect, useMemo, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { ModeDial } from "#/chat/mode-dial";
import { NewThreadButtons, ThreadDialog, ThreadsSidebar } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
import { selectBreakdown, selectRunStatus, selectTitle } from "#/workbench/chat-state";
import { EmptyState } from "#/components/lang/empty";
import { buildTraceCells, ToolCellBody, TraceCellView } from "#/workbench/lens/context-strip";
import { Press } from "#/components/lang/press";
import { X } from "lucide-react";
import { chatPluginTitle, type ChatPluginRoute } from "#/workbench/chat-plugins";
import { useChatPluginHost } from "#/workbench/route-panes";
import { ChatCluster, ComposerHead, useChatSituation } from "#/chat/composer-head";
import { RouteShell, useRoute } from "#/route";
import { appAtomRegistry } from "#/route/route-owner";
import { useScopeKeys } from "#/route/keys";
import { chatManifest } from "#/chat/manifest";
import "#/workbench/lens.css";
import { CurrentThreadViewOwner, useCurrentThreadView } from "#/workbench/thread-view";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface as PageSurface } from "#/components/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";

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
    harnesses,
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
    openThread,
    renameThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
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
      }),
    [currentThreadId, loading, isRunning, sendPrompt, cancel, newThread, forkThread, newRefusal],
  );
  // The handle is owned here, not inside the shell: Chat has no route head, and its composer
  // head is the Situation, which needs the same handle the shell's chords run through.
  const handle = useRoute(manifest);
  const situation = useChatSituation(handle);
  const handleRenameThread = (id: string, title: string) => void renameThread(id, title);
  const [deletedThreadIds, setDeletedThreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const handleDeleteThread = async (id: string) => {
    if (await deleteThread(id)) setDeletedThreadIds((previous) => new Set([...previous, id]));
  };
  const paletteOpen = useAtomValue(store.atoms.paletteOpen);
  const sideOpen = useAtomValue(store.atoms.sideOpen);
  const pluginOpen = useAtomValue(store.atoms.pluginOpen);
  // A tool call clicked open in the transcript owns the trace lane's inspect window until unpinned.
  const view = useCurrentThreadView();
  const pinKey = useAtomValue(view.atoms.lensPinKey);
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
        <Press
          tone="quiet"
          size="caption"
          title="Show the whole Work"
          onClick={() => store.actions.setPlugin(plugin)}
        >
          {focusPath.join(" › ")} <X />
        </Press>
      ) : null}
      <Press
        tone="quiet"
        size="icon"
        title="Close workspace"
        onClick={() => store.actions.setPlugin(undefined)}
      >
        <X className="size-4" strokeWidth={1.5} />
      </Press>
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
  const traceCells = useMemo(() => buildTraceCells(chat), [chat]);
  const traceCell = traceCells.find((cell) => cell.key === pinKey) ?? null;
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
    ...(["Mod+1", "Mod+2", "Mod+3"] as const).map((hotkey, i) => ({
      hotkey,
      callback: () => setMode(MODES[i]!),
      label: `${MODES[i]} mode`,
      says: `switch the chat to ${MODES[i]}`,
    })),
  ]);

  const runStatus = selectRunStatus(chat);
  const status = {
    text: turnFailure
      ? "failed"
      : loading
        ? "loading thread state"
        : runStatus === "waiting"
          ? "waiting for you"
          : runStatus === "running"
            ? "running"
            : "ready",
    caution: turnFailure !== undefined,
    detail: operationError ?? turnFailure,
  };
  const chatColumn = (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-y-[var(--gutter)]">
      <div className="min-h-0 min-w-0 flex-1">
        <Pane
          kind="content"
          scroll="clip"
          flush
          id="transcript"
          title={
            selectTitle(chat) ||
            threads.find((thread) => thread.id === currentThreadId)?.title ||
            "thread"
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
              <NewThreadButtons
                harnesses={harnesses}
                onNew={(harness) => void newThread(harness)}
              />
            </div>
          ) : (
            <ThreadBody bodyAtom={bodyAtom} state={chat} mode={mode} sideOpen={sideOpen} />
          )}
        </Pane>
      </div>
      <ComposerBank
        currentThreadId={currentThreadId}
        deletedThreadIds={deletedThreadIds}
        prompt={prompt}
        handle={handle}
        topBar={
          <>
            <ComposerHead
              handle={handle}
              situation={situation}
              status={status}
              urlTarget={target}
            />
          </>
        }
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
          no route head: the Situation is the composer head (`ComposerHead`), so the shell draws
          none of its own. */}
      <RouteShell manifest={manifest} handle={handle} situation={<></>}>
        <PageSurface>
          <PaneSplit
            axis="horizontal"
            grow
            resize={{
              target: "start",
              defaultSize: 300,
              minSize: 240,
              persist: "pe.sideWidth",
              collapse: { collapsed: !sideOpen, collapsedSize: 40 },
            }}
            start={
              <Pane
                kind="flank"
                flush
                id="threads"
                title="threads"
                meta={threads.length}
                actions={<ModeDial mode={mode} setMode={setMode} />}
                collapsed={!sideOpen}
                onCollapsedChange={(collapsed) => store.actions.setSideOpen(!collapsed)}
              >
                {mode === "threads" ? (
                  <ThreadsSidebar
                    threads={threads}
                    harnesses={harnesses}
                    currentThreadId={currentThreadId}
                    onSelect={openThread}
                    onNew={(harness) => void newThread(harness)}
                    onFork={(id, harness) => void forkThread(harness, id)}
                    onRename={handleRenameThread}
                    onDelete={handleDeleteThread}
                    onSearch={() => store.actions.setPaletteOpen(true)}
                  />
                ) : mode === "trace" ? (
                  <div data-annotation="trace-frame">
                    <div data-annotation="trace-pin">
                      {traceCells.map((cell) => (
                        <TraceCellView key={cell.key} cell={cell} registerRef={() => {}} />
                      ))}
                    </div>
                    {traceCell ? (
                      <div data-annotation="inspect" data-pinned>
                        <Press
                          tone="quiet"
                          size="caption"
                          title="Unpin this call"
                          onClick={() => view.actions.setLensPinKey(null)}
                        >
                          unpin
                        </Press>
                        <ToolCellBody call={traceCell.call} />
                      </div>
                    ) : null}
                  </div>
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
                  collapse: { collapsed: !plugin || !pluginOpen, collapsedSize: 40 },
                }}
                start={chatColumn}
                end={
                  plugin ? (
                    <Pane
                      kind="flank"
                      flush
                      side="right"
                      id="plugin"
                      title={chatPluginTitle(plugin)}
                      collapsed={!pluginOpen}
                      onCollapsedChange={(collapsed) => store.actions.setPluginOpen(!collapsed)}
                      actions={chrome}
                      headerless
                    >
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
      <ThreadDialog
        threads={threads}
        harnesses={harnesses}
        currentThreadId={currentThreadId}
        open={paletteOpen}
        onOpenChange={store.actions.setPaletteOpen}
        onSelect={openThread}
        onNew={(harness) => void newThread(harness)}
        onFork={(id, harness) => void forkThread(harness, id)}
        onRename={handleRenameThread}
        onDelete={handleDeleteThread}
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
