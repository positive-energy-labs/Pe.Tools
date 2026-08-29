import { chatStyles } from "#/components/lang/chat-appearance";
import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { ModeDial } from "#/chat/mode-dial";
import { Composer } from "#/chat/composer";
import { ThreadList, ThreadPalette } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { WorkbenchRuntimeProvider } from "#/workbench/aui";
import { Lens } from "#/workbench/Lens";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { selectBreakdown, selectRunStatus } from "#/workbench/chat-state";
import { Press } from "#/components/lang/press";
import { SidePane } from "#/components/lang/side-pane";
import { X } from "lucide-react";
import { chatPluginTitle } from "#/workbench/route-chat-plugins";
import { selectRoutePane } from "#/workbench/route-panes";
import { ChatSentence } from "#/chat/chat-sentence";
import { WorldBadge } from "#/chat/world-badge";
import "#/workbench/lens.css";

/** Routes hostable as in-realm chat workspace panes.
 * Route names and titles come from the plugin registry — one registration per route. */
export type { ChatPluginRoute } from "#/workbench/route-chat-plugins";
import type { ChatPluginRoute } from "#/workbench/route-chat-plugins";

export function ChatShell({
  initialTurn,
  plugin,
}: {
  initialTurn?: number;
  plugin?: ChatPluginRoute;
}) {
  return (
    <HotkeysProvider>
      <WorkbenchRuntimeProvider>
        <Surface initialTurn={initialTurn} plugin={plugin} />
      </WorkbenchRuntimeProvider>
    </HotkeysProvider>
  );
}

function Surface({ initialTurn, plugin }: { initialTurn?: number; plugin?: ChatPluginRoute }) {
  const {
    store,
    chat,
    loading,
    error,
    threads,
    currentThreadId,
    world,
    operationError,
    newThread,
    openThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  const paletteOpen = useAtomValue(store.atoms.paletteOpen);
  // The side lane is a SidePane (rendered inside the Lens grid) that owns its own width, drag,
  // collapse, and persistence (storageKey "pe.sideWidth").
  const sideOpen = useAtomValue(store.atoms.sideOpen);
  // The plugin workspace is a right SidePane. Only ONE flank may be expanded at a time:
  // opening either pane collapses the other to its 40px rail (nothing is unmounted).
  const pluginOpen = useAtomValue(store.atoms.pluginOpen);
  useEffect(() => {
    if (plugin) {
      store.actions.setPluginOpen(true);
      store.actions.setSideOpen(false);
    }
  }, [plugin, store]);
  const openSide = (open: boolean) => {
    store.actions.setSideOpen(open);
    if (open) store.actions.setPluginOpen(false);
  };
  const openPlugin = (open: boolean) => {
    store.actions.setPluginOpen(open);
    if (open) store.actions.setSideOpen(false);
  };
  // Collapsed → the pane is a 40px rail (SidePane's RAIL) and the chat column absorbs the rest.
  const PluginPane = plugin ? selectRoutePane(plugin) : null;

  const status = selectRunStatus(chat);
  const threadLabel = threads.find((item) => item.id === currentThreadId)?.title ?? "new session";
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
    { hotkey: "Mod+K", callback: () => store.actions.setPaletteOpen((open) => !open) },
    { hotkey: "Mod+1", callback: () => setMode(MODES[0]!) },
    { hotkey: "Mod+2", callback: () => setMode(MODES[1]!) },
    { hotkey: "Mod+3", callback: () => setMode(MODES[2]!) },
  ]);

  const statusLine = loading ? "Loading thread state" : (error ?? operationError);

  return (
    <main ref={mainRef} data-mode={mode} data-plugin={plugin} className={chatStyles.chatShell0()}>
      {/* Inner grid holds exactly the 3 rows; ThreadPalette stays OUT of the grid (its sr-only
          dialog header would otherwise absorb the 1fr lens row via auto-placement). */}
      <div className={chatStyles.chatShell1()}>
        <header className={chatStyles.chatShell2()}>
          <div className={chatStyles.chatShell3()}>
            {/* status lamp on meaning roles: running = pea acting (agent identity), waiting =
                your call is owed (caution), error = a bridge/run error (caution — NOT the
                alarm), idle = muted. */}
            <span title={status} className={chatStyles.chatShell4()} data-s={status} />
            <span className={chatStyles.chatShell5()}>{threadLabel}</span>
          </div>
          <div className={chatStyles.chatShell6()}>
            <WorldBadge world={world} />
            <ChatSentence />
          </div>
        </header>

        <div aria-live="polite" className={chatStyles.chatShell7()}>
          {statusLine ? (
            <div
              className={
                error || operationError ? chatStyles.statusError() : chatStyles.statusQuiet()
              }
            >
              {statusLine}
            </div>
          ) : null}
        </div>

        <div className={chatStyles.chatShell8()}>
          <div className={chatStyles.chatShell9()}>
            <Lens
              state={chat}
              mode={mode}
              initialTurn={initialTurn}
              scrollKey={currentThreadId}
              onTurnChange={store.actions.setTurn}
              sideOpen={sideOpen}
              onSideOpenChange={openSide}
              sideHead={<ModeDial mode={mode} setMode={setMode} />}
              threadList={
                <ThreadList
                  threads={threads}
                  currentThreadId={currentThreadId}
                  onSelect={openThread}
                  onNew={newThread}
                  onDelete={(id) => void deleteThread(id)}
                  onSearch={() => store.actions.setPaletteOpen(true)}
                />
              }
            />
            <div className={chatStyles.chatShell10()}>
              <div className={chatStyles.chatShell11()}>
                <div ref={composerRef} className={chatStyles.chatShell12()}>
                  <Composer
                    setMode={setMode}
                    topBar={
                      <ContextRibbon
                        breakdown={breakdown}
                        cache={cache}
                        onOpenWorld={() => setMode("world")}
                      />
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
              onOpenChange={openPlugin}
              minWidth={480}
              defaultWidth={640}
              header={
                <div className={chatStyles.chatShell13()}>
                  <span className={chatStyles.chatShell14()}>{chatPluginTitle(plugin)}</span>
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
      </div>

      <ThreadPalette
        threads={threads}
        currentThreadId={currentThreadId}
        open={paletteOpen}
        onOpenChange={store.actions.setPaletteOpen}
        onSelect={openThread}
        onNew={newThread}
        onDelete={(id) => void deleteThread(id)}
      />
    </main>
  );
}
