import { useEffect, useMemo, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { ModeDial } from "#/chat/mode-dial";
import { ThreadList, ThreadPalette } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
import { selectBreakdown, selectRunStatus } from "#/workbench/chat-state";
import { buildTraceCells, ToolCellBody, TraceCellView } from "#/workbench/lens/context-strip";
import { Press } from "#/components/lang/press";
import { X } from "lucide-react";
import { chatPluginTitle } from "#/workbench/route-chat-plugins";
import { selectRoutePane } from "#/workbench/route-panes";
import { ComposerHead } from "#/chat/composer-head";
import { appAtomRegistry, RouteShell, keyMeta, useRoute } from "#/route";
import { chatManifest } from "#/chat/manifest";
import "#/workbench/lens.css";
import { CurrentThreadViewOwner, useCurrentThreadView } from "#/workbench/thread-view";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface as PageSurface, SurfaceCell } from "#/components/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";

/** Routes hostable as in-realm chat workspace panes.
 * Route names and titles come from the plugin registry — one registration per route. */
export type { ChatPluginRoute } from "#/workbench/route-chat-plugins";
import type { ChatPluginRoute } from "#/workbench/route-chat-plugins";

export function ChatShell({ plugin }: { plugin?: ChatPluginRoute }) {
  return (
    <HotkeysProvider>
      <CurrentThreadChatSurface plugin={plugin} />
    </HotkeysProvider>
  );
}

function CurrentThreadChatSurface({ plugin }: { plugin?: ChatPluginRoute }) {
  const { currentThreadId, turn, patchThreadView } = useWorkbench();
  return (
    <CurrentThreadViewOwner
      threadKey={currentThreadId}
      registry={appAtomRegistry}
      turn={turn}
      patch={patchThreadView}
    >
      <ChatSurface plugin={plugin} />
    </CurrentThreadViewOwner>
  );
}

function ChatSurface({ plugin }: { plugin?: ChatPluginRoute }) {
  const {
    store,
    chat,
    bodyAtom,
    loading,
    threads,
    currentThreadId,
    prompt,
    displayKnown,
    turnFailure,
    turnFailed,
    session,
    operationError,
    sendPrompt,
    newThread,
    forkThread,
    openThread,
    renameThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  // The route, re-declared with this thread and this session bound. `routes/chat.tsx` exports the
  // static one; the actions only become runnable once the provider has a session.
  const manifest = useMemo(
    () =>
      chatManifest({
        thread: currentThreadId ?? "",
        display: chat.display,
        displayKnown,
        session,
        send: (input) => sendPrompt(input.text, input.attachments),
        hasMessages: chat.messages.length > 0,
        newThread,
        forkThread,
      }),
    [
      currentThreadId,
      chat.display,
      displayKnown,
      chat.messages.length,
      session,
      sendPrompt,
      newThread,
      forkThread,
    ],
  );
  // The handle is owned here, not inside the shell: Chat has no route head, and its composer
  // head is the Situation, which needs the same handle the shell's chords run through.
  const handle = useRoute(manifest);
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
  const PluginPane = plugin ? selectRoutePane(plugin) : null;

  // Context gauges (cap + OM meters) ride beside the composer now, so the cache view is derived
  // here instead of inside the Lens. userTurns gates the diff baseline (advances on each send).
  const breakdown = useMemo(() => selectBreakdown(chat), [chat]);
  const userTurns = useMemo(
    () => chat.messages.reduce((count, m) => (m.role === "user" ? count + 1 : count), 0),
    [chat.messages],
  );
  const cache = useCacheView(breakdown, userTurns);
  const traceCells = useMemo(() => buildTraceCells(chat), [chat]);
  const traceCell = traceCells.find((cell) => cell.key === pinKey) ?? null;
  const retryBody = useAtomRefresh(bodyAtom);

  useHotkeys([
    // Surface chords, not manifest actions: they move Page state and never refuse. Tagged so the
    // help page lists them beside the route's chords.
    {
      hotkey: "Mod+K",
      callback: () => store.actions.setPaletteOpen((open) => !open),
      options: {
        meta: keyMeta({
          name: "palette",
          description: "open or close the Do palette",
          tier: "route",
        }),
      },
    },
    ...(["Mod+1", "Mod+2", "Mod+3"] as const).map((hotkey, i) => ({
      hotkey,
      callback: () => setMode(MODES[i]!),
      options: {
        meta: keyMeta({
          name: `${MODES[i]} mode`,
          description: `switch the chat to ${MODES[i]}`,
          tier: "route",
        }),
      },
    })),
  ]);

  const runStatus = selectRunStatus(chat);
  const status = operationError
    ? { text: operationError, caution: true }
    : turnFailure
      ? { text: turnFailure.message, caution: true }
      : turnFailed
        ? { text: "failed", caution: true }
        : !displayKnown
          ? { text: loading ? "loading thread state" : "connecting", caution: false }
          : {
              text:
                runStatus === "waiting"
                  ? "waiting for you"
                  : runStatus === "running"
                    ? "running"
                    : "ready",
              caution: false,
            };
  const chatColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 min-w-0 flex-1">
        <Pane
          kind="content"
          scroll="clip"
          id="transcript"
          title={threads.find((thread) => thread.id === currentThreadId)?.title ?? "thread"}
          boundaryKey={currentThreadId}
          onRetry={retryBody}
        >
          <ThreadBody bodyAtom={bodyAtom} state={chat} mode={mode} sideOpen={sideOpen} />
        </Pane>
      </div>
      <Pane
        kind="content"
        scroll="visible"
        id="composer"
        title="composer"
        help="Drafts stay with their visited thread until sent or deleted."
        headerSurface="recess"
        boundary={false}
        headerless
      >
        <ComposerBank
          currentThreadId={currentThreadId}
          deletedThreadIds={deletedThreadIds}
          prompt={prompt}
          handle={handle}
          topBar={
            <>
              <ComposerHead handle={handle} status={status} />
              <ContextRibbon
                breakdown={breakdown}
                cache={cache}
                onOpenWorld={() => setMode("world")}
              />
            </>
          }
        />
      </Pane>
    </div>
  );

  return (
    <main
      data-chat="surface"
      data-mode={mode}
      data-plugin={plugin}
      className="h-dvh font-sans text-ink"
    >
      {/* The route shell owns the chords and the remaining-height conversation column. Chat has
          no route head: the Situation is the composer head (`ComposerHead`), so the shell draws
          none of its own. */}
      <RouteShell manifest={manifest} handle={handle} situation={<></>}>
        <PageSurface columns="minmax(0, 1fr)">
          <SurfaceCell>
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
                  id="threads"
                  title="threads"
                  meta={threads.length}
                  actions={<ModeDial mode={mode} setMode={setMode} />}
                  collapsed={!sideOpen}
                  onCollapsedChange={(collapsed) => store.actions.setSideOpen(!collapsed)}
                >
                  {mode === "threads" ? (
                    <ThreadList
                      threads={threads}
                      currentThreadId={currentThreadId}
                      onSelect={openThread}
                      onNew={newThread}
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
                plugin ? (
                  <PaneSplit
                    axis="horizontal"
                    grow
                    resize={{
                      target: "end",
                      defaultSize: 640,
                      minSize: 480,
                      persist: "pe.pluginWidth",
                      collapse: { collapsed: !pluginOpen, collapsedSize: 40 },
                    }}
                    start={chatColumn}
                    end={
                      <Pane
                        kind="flank"
                        side="right"
                        id="plugin"
                        title={chatPluginTitle(plugin)}
                        collapsed={!pluginOpen}
                        onCollapsedChange={(collapsed) => store.actions.setPluginOpen(!collapsed)}
                        actions={
                          <Press
                            tone="quiet"
                            size="icon"
                            title="Close workspace"
                            onClick={() => store.actions.setPlugin(undefined)}
                          >
                            <X />
                          </Press>
                        }
                      >
                        {PluginPane ? <PluginPane store={store} /> : null}
                      </Pane>
                    }
                  />
                ) : (
                  chatColumn
                )
              }
            />
          </SurfaceCell>
        </PageSurface>
      </RouteShell>

      <ThreadPalette
        threads={threads}
        currentThreadId={currentThreadId}
        open={paletteOpen}
        onOpenChange={store.actions.setPaletteOpen}
        onSelect={openThread}
        onNew={newThread}
        onRename={handleRenameThread}
        onDelete={handleDeleteThread}
      />
    </main>
  );
}
