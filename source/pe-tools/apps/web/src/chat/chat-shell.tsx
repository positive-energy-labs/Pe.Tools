import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { ModeDial } from "#/chat/mode-dial";
import { Composer } from "#/chat/composer";
import { ThreadList, ThreadPalette } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { Lens } from "#/workbench/Lens";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { selectBreakdown } from "#/workbench/chat-state";
import { Press } from "#/components/lang/press";
import { SidePane } from "#/components/lang/side-pane";
import { X } from "lucide-react";
import { chatPluginTitle } from "#/workbench/route-chat-plugins";
import { selectRoutePane } from "#/workbench/route-panes";
import { ComposerHead } from "#/chat/composer-head";
import { RouteShell, keyMeta, useRoute } from "#/route";
import { chatManifest } from "#/chat/manifest";
import "#/workbench/lens.css";

/** Routes hostable as in-realm chat workspace panes.
 * Route names and titles come from the plugin registry — one registration per route. */
export type { ChatPluginRoute } from "#/workbench/route-chat-plugins";
import type { ChatPluginRoute } from "#/workbench/route-chat-plugins";

export function ChatShell({ plugin }: { plugin?: ChatPluginRoute }) {
  return (
    <HotkeysProvider>
      <Surface plugin={plugin} />
    </HotkeysProvider>
  );
}

function Surface({ plugin }: { plugin?: ChatPluginRoute }) {
  const {
    store,
    chat,
    loading,
    error,
    threads,
    currentThreadId,
    session,
    operationError,
    sendPrompt,
    newThread,
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
        session,
        send: (input) => sendPrompt(input.text, input.attachments),
      }),
    [currentThreadId, chat.display, session, sendPrompt],
  );
  // The handle is owned here, not inside the shell: Chat has no route head, and its composer
  // head is the Situation, which needs the same handle the shell's chords run through.
  const handle = useRoute(manifest);
  const handleRenameThread = (id: string, title: string) => void renameThread(id, title);
  const handleDeleteThread = (id: string) => void deleteThread(id);
  const paletteOpen = useAtomValue(store.atoms.paletteOpen);
  // The side lane is a SidePane (rendered inside the Lens grid) that owns its own width, drag,
  // collapse, and persistence (storageKey "pe.sideWidth").
  const sideOpen = useAtomValue(store.atoms.sideOpen);
  // The plugin workspace is a right SidePane. Only ONE flank may be expanded at a time:
  // opening either pane collapses the other to its 40px rail (nothing is unmounted).
  const pluginOpen = useAtomValue(store.atoms.pluginOpen);
  // A tool call clicked open in the transcript owns the trace lane's inspect window until unpinned.
  const pinKey = useAtomValue(store.atoms.lensPinKey);
  useEffect(() => {
    if (plugin) store.actions.setPluginOpen(true);
  }, [plugin, store]);
  // Collapsed → the pane is a 40px rail (SidePane's RAIL) and the chat column absorbs the rest.
  const PluginPane = plugin ? selectRoutePane(plugin) : null;

  // Context gauges (cap + OM meters) ride beside the composer now, so the cache view is derived
  // here instead of inside the Lens. userTurns gates the diff baseline (advances on each send).
  const breakdown = useMemo(() => selectBreakdown(chat), [chat]);
  const userTurns = useMemo(
    () => chat.messages.reduce((count, m) => (m.role === "user" ? count + 1 : count), 0),
    [chat.messages],
  );
  const cache = useCacheView(breakdown, userTurns);

  // The composer floats over the chat lane; publish its live height as --composer-h so the chat
  // can pad its tail by exactly the input box (which grows as the textarea expands).
  const mainRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    const box = composerRef.current;
    if (!main || !box) return;
    const apply = () => main.style.setProperty("--composer-h", `${box.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

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
      ref={mainRef}
      data-chat="surface"
      data-mode={mode}
      data-plugin={plugin}
      data-surface="page"
      className="fixed inset-0 font-sans text-ink"
    >
      {/* The route shell owns the chords and the remaining-height conversation column. Chat has
          no route head: the Situation is the composer head (`ComposerHead`), so the shell draws
          none of its own. */}
      <div className="h-full px-5">
        <RouteShell manifest={manifest} handle={handle} situation={<></>}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <div className="relative min-h-0 min-w-0 flex-1">
              <Lens
                state={chat}
                mode={mode}
                sideOpen={sideOpen}
                onSideOpenChange={store.actions.setSideOpen}
                pinKey={pinKey}
                onPinChange={store.actions.setLensPinKey}
                sideHead={<ModeDial mode={mode} setMode={setMode} />}
                threadList={
                  <ThreadList
                    threads={threads}
                    currentThreadId={currentThreadId}
                    onSelect={openThread}
                    onNew={newThread}
                    onRename={handleRenameThread}
                    onDelete={handleDeleteThread}
                    onSearch={() => store.actions.setPaletteOpen(true)}
                  />
                }
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-3">
                <div className="pe-composer-lane">
                  <div ref={composerRef} className="pointer-events-auto">
                    <Composer
                      setMode={setMode}
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
                  </div>
                </div>
              </div>
            </div>

            {plugin ? (
              <SidePane
                side="right"
                storageKey="pe.pluginWidth"
                open={pluginOpen}
                onOpenChange={store.actions.setPluginOpen}
                minWidth={480}
                defaultWidth={640}
                header={
                  <div className="flex items-center justify-between">
                    <span className="truncate t-title">{chatPluginTitle(plugin)}</span>
                    <Press
                      tone="neutral"
                      size="icon"
                      title="Close workspace"
                      onClick={() => store.actions.setPlugin(undefined)}
                    >
                      <X />
                    </Press>
                  </div>
                }
              >
                {/* The pane resolves its route document from the active rvt Address. */}
                {PluginPane ? <PluginPane store={store} /> : null}
              </SidePane>
            ) : null}
          </div>
        </RouteShell>
      </div>

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
