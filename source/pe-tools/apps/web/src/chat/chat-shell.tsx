import { Activity, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { ModeDial } from "#/chat/mode-dial";
import { ThreadComposer } from "#/chat/composer";
import type { ChatHandle } from "#/chat/composer-head";
import { ThreadList, ThreadPalette } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
import { selectBreakdown } from "#/workbench/chat-state";
import { buildTraceCells, ToolCellBody, TraceCellView } from "#/workbench/lens/context-strip";
import { Press } from "#/components/lang/press";
import { X } from "lucide-react";
import { chatPluginTitle } from "#/workbench/route-chat-plugins";
import { selectRoutePane } from "#/workbench/route-panes";
import { ComposerHead } from "#/chat/composer-head";
import { RouteShell, keyMeta, useRoute } from "#/route";
import { chatManifest } from "#/chat/manifest";
import "#/workbench/lens.css";
import type { ChatDraft } from "#/workbench/prompt";
import { useCurrentThreadView } from "#/workbench/thread-view";
import { Pane } from "#/components/lang/pane";
import { Surface as PageSurface, SurfaceCell, SurfaceHandle } from "#/components/lang/surface";
import { usePaneSize } from "#/components/lang/pane-resize";
import { ThreadBody } from "#/workbench/lens/thread-body";

/** Routes hostable as in-realm chat workspace panes.
 * Route names and titles come from the plugin registry — one registration per route. */
export type { ChatPluginRoute } from "#/workbench/route-chat-plugins";
import type { ChatPluginRoute } from "#/workbench/route-chat-plugins";

export function ChatShell({ plugin }: { plugin?: ChatPluginRoute }) {
  return (
    <HotkeysProvider>
      <ChatSurface plugin={plugin} />
    </HotkeysProvider>
  );
}

function ChatSurface({ plugin }: { plugin?: ChatPluginRoute }) {
  const {
    store,
    chat,
    bodyAtom,
    loading,
    error,
    threads,
    currentThreadId,
    prompt,
    displayKnown,
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
  const handleDeleteThread = (id: string) => void deleteThread(id);
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
  const sideSize = usePaneSize({
    defaultSize: 300,
    minSize: 240,
    persist: "pe.sideWidth",
    collapse: { collapsed: !sideOpen, collapsedSize: 40 },
  });
  const pluginSize = usePaneSize({
    defaultSize: 640,
    minSize: 480,
    persist: "pe.pluginWidth",
    collapse: { collapsed: !pluginOpen, collapsedSize: 40 },
  });

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

  const statusText = loading ? "Loading thread state" : (error ?? operationError);
  const status = statusText
    ? { text: statusText, caution: Boolean(error || operationError) }
    : undefined;

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
        <PageSurface
          columns={`${sideSize.renderedSize}px var(--gutter) minmax(0,1fr)${plugin ? ` var(--gutter) ${pluginSize.renderedSize}px` : ""}`}
        >
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
          <SurfaceHandle
            axis="horizontal"
            value={sideSize.renderedSize}
            startValue={sideSize.size}
            min={240}
            growth={1}
            containerSize={() => undefined}
            onResize={sideSize.resizeTo}
            onReset={sideSize.reset}
          />
          <SurfaceCell>
            <Pane
              kind="content"
              id="transcript"
              title={threads.find((thread) => thread.id === currentThreadId)?.title ?? "thread"}
              boundaryKey={currentThreadId}
              onRetry={retryBody}
            >
              <ThreadBody bodyAtom={bodyAtom} state={chat} mode={mode} sideOpen={sideOpen} />
            </Pane>
            <Pane kind="content" id="composer" headerSurface="recess" boundary={false} headerless>
              <ComposerBank
                currentThreadId={currentThreadId}
                threads={threads}
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
          </SurfaceCell>
          {plugin ? (
            <>
              <SurfaceHandle
                axis="horizontal"
                value={pluginSize.renderedSize}
                startValue={pluginSize.size}
                min={480}
                growth={-1}
                containerSize={() => undefined}
                onResize={pluginSize.resizeTo}
                onReset={pluginSize.reset}
              />
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
            </>
          ) : null}
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

function ComposerBank({
  currentThreadId,
  threads,
  prompt,
  handle,
  topBar,
}: {
  currentThreadId: string;
  threads: { id: string }[];
  prompt?: string;
  handle: ChatHandle;
  topBar: ReactNode;
}) {
  const [visited, setVisited] = useState(() => new Set([currentThreadId]));
  const known = useMemo(
    () => new Set([...threads.map(({ id }) => id), currentThreadId]),
    [threads, currentThreadId],
  );
  useEffect(() => {
    setVisited((previous) => {
      const next = new Set([...previous, currentThreadId].filter((id) => known.has(id)));
      return next.size === previous.size && [...next].every((id) => previous.has(id))
        ? previous
        : next;
    });
  }, [currentThreadId, known]);
  const composerIds = useMemo(
    () => [...new Set([...visited, currentThreadId])],
    [visited, currentThreadId],
  );
  return (
    <div className="pointer-events-auto">
      {composerIds.map((threadId) => {
        const initialDraft: ChatDraft | undefined =
          threadId === currentThreadId && prompt ? { text: prompt, attachments: [] } : undefined;
        return (
          <Activity key={threadId} mode={threadId === currentThreadId ? "visible" : "hidden"}>
            <ThreadComposer handle={handle} topBar={topBar} initialDraft={initialDraft} />
          </Activity>
        );
      })}
    </div>
  );
}
