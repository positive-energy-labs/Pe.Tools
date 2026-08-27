import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { selectWorkbenchChrome } from "@pe/agent-contracts";
import { ModeDial } from "#/components/mode-dial";
import { Composer } from "#/components/composer";
import { ThreadList, ThreadPalette } from "#/components/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { WorkbenchRuntimeProvider } from "#/workbench/aui";
import { Lens } from "#/workbench/Lens";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { Button } from "#/components/ui/button";
import { SidePane } from "#/components/ui/side-pane";
import { X } from "lucide-react";
import { chatPluginTitle } from "#/workbench/route-chat-plugins";
import { selectRoutePane } from "#/workbench/route-panes";
import { ChatSentence } from "#/components/chat-sentence";
import { WorldBadge } from "#/components/world-badge";
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
    debug,
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

  const chrome = useMemo(() => selectWorkbenchChrome(debug.state), [debug.state]);
  // Context gauges (cap + OM meters) ride beside the composer now, so the cache view is derived
  // here instead of inside the Lens. userTurns gates the diff baseline (advances on each send).
  const breakdown = debug.state.inspector.contextBreakdown;
  const userTurns = useMemo(
    () =>
      debug.state.transcript.messages.reduce(
        (count, message) => (message.role === "user" ? count + 1 : count),
        0,
      ),
    [debug.state.transcript.messages],
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

  const statusLine = debug.loading ? "Loading thread state" : (debug.error ?? operationError);

  return (
    <main
      ref={mainRef}
      data-mode={mode}
      data-plugin={plugin}
      className="fixed inset-0 bg-background font-pe text-foreground"
    >
      {/* Inner grid holds exactly the 3 rows; ThreadPalette stays OUT of the grid (its sr-only
          dialog header would otherwise absorb the 1fr lens row via auto-placement). */}
      <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--r-line)] px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* status lamp on meaning roles: running = pea acting (agent identity), waiting =
                your call is owed (caution), error = a bridge/run error (caution — NOT the
                alarm), idle = muted. */}
            <span
              title={chrome.status}
              className="size-2 shrink-0 rounded-full data-[s=error]:bg-[var(--r-caution)] data-[s=idle]:bg-[var(--r-ink-mute)] data-[s=running]:bg-[var(--r-pea)] data-[s=waiting]:bg-[var(--r-caution)]"
              data-s={chrome.status}
            />
            <span className="truncate text-sm font-semibold">{chrome.threadLabel}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <WorldBadge world={world} />
            <ChatSentence />
          </div>
        </header>

        <div aria-live="polite" className="min-h-0 px-5">
          {statusLine ? (
            <div
              className={`border-b border-[var(--r-line)] py-1.5 t-label ${
                debug.error || operationError ? "text-[var(--r-caution)]" : "text-[var(--r-ink-2)]"
              }`}
            >
              {statusLine}
            </div>
          ) : null}
        </div>

        <div className="relative flex min-h-0 min-w-0">
          <div className="relative min-h-0 min-w-0 flex-1">
            <Lens
              state={debug.state}
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
            <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-4">
              <div className="pe-composer-lane">
                <div ref={composerRef} className="pointer-events-auto">
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
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-semibold">{chatPluginTitle(plugin)}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Close workspace"
                    onClick={() => store.actions.setPlugin(undefined)}
                  >
                    <X />
                  </Button>
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
