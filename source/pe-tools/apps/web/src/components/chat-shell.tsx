import { useEffect, useMemo, useRef, useState } from "react";
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
import "#/workbench/lens.css";

/** Routes hostable as chat workspace plugins; the iframe src is `/${plugin}`.
 * Route names and titles come from the plugin registry — one registration per route. */
export type { ChatPluginRoute } from "#/workbench/route-chat-plugins";
import type { ChatPluginRoute } from "#/workbench/route-chat-plugins";

export function ChatShell({
  initialTurn,
  plugin,
  onTurnChange,
  onPluginClose,
  promptSeed,
}: {
  initialTurn?: number;
  plugin?: ChatPluginRoute;
  onTurnChange?: (turn: number | undefined) => void;
  onPluginClose?: () => void;
  promptSeed?: string;
}) {
  return (
    <HotkeysProvider>
      <WorkbenchRuntimeProvider>
        <Surface
          initialTurn={initialTurn}
          plugin={plugin}
          promptSeed={promptSeed}
          onTurnChange={onTurnChange}
          onPluginClose={onPluginClose}
        />
      </WorkbenchRuntimeProvider>
    </HotkeysProvider>
  );
}

function Surface({
  initialTurn,
  plugin,
  onTurnChange,
  onPluginClose,
  promptSeed,
}: {
  initialTurn?: number;
  plugin?: ChatPluginRoute;
  onTurnChange?: (turn: number | undefined) => void;
  onPluginClose?: () => void;
  promptSeed?: string;
}) {
  const {
    debug,
    threads,
    currentThreadId,
    operationError,
    readOnly,
    takeOverThread,
    newThread,
    switchThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The side lane is a SidePane (rendered inside the Lens grid) that owns its own width, drag,
  // collapse, and persistence (storageKey "pe.sideWidth"). We mirror its width/open here only to
  // drive --side, which positions the floating composer lane (margin-left) and feeds nothing else.
  // Initial width matches the pane's own localStorage read so --side is correct on first paint.
  const [sideWidth, setSideWidth] = useState(() => {
    const saved = Number(localStorage.getItem("pe.sideWidth"));
    return saved >= 240 ? saved : 300;
  });
  const [sideOpen, setSideOpen] = useState(true);
  // The plugin workspace is a right SidePane. Only ONE flank may be expanded at a time:
  // opening either pane collapses the other to its 40px rail (nothing is unmounted).
  const [pluginOpen, setPluginOpen] = useState(false);
  useEffect(() => {
    if (plugin) {
      setPluginOpen(true);
      setSideOpen(false);
    }
  }, [plugin]);
  const openSide = (open: boolean) => {
    setSideOpen(open);
    if (open) setPluginOpen(false);
  };
  const openPlugin = (open: boolean) => {
    setPluginOpen(open);
    if (open) setSideOpen(false);
  };
  // Collapsed → the pane is a 40px rail (SidePane's RAIL) and the chat column absorbs the rest.
  const sideSize = sideOpen ? Math.round(sideWidth) : 40;

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
    { hotkey: "Mod+K", callback: () => setPaletteOpen((open) => !open) },
    { hotkey: "Mod+1", callback: () => setMode(MODES[0]!) },
    { hotkey: "Mod+2", callback: () => setMode(MODES[1]!) },
    { hotkey: "Mod+3", callback: () => setMode(MODES[2]!) },
  ]);

  const statusLine = readOnly
    ? null
    : debug.loading
      ? "Loading thread state"
      : (debug.error ?? operationError);

  return (
    <main
      ref={mainRef}
      data-mode={mode}
      data-plugin={plugin}
      style={{ "--side": `${sideSize}px` } as React.CSSProperties}
      className="fixed inset-0 bg-background font-pe text-foreground"
    >
      {/* Inner grid holds exactly the 3 rows; ThreadPalette stays OUT of the grid (its sr-only
          dialog header would otherwise absorb the 1fr lens row via auto-placement). */}
      <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              title={chrome.status}
              className="size-2 shrink-0 rounded-full data-[s=error]:bg-destructive data-[s=idle]:bg-muted-foreground/50 data-[s=running]:bg-primary data-[s=waiting]:bg-accent-foreground"
              data-s={chrome.status}
            />
            <span className="truncate text-sm font-semibold">{chrome.threadLabel}</span>
          </div>
        </header>

        <div aria-live="polite" className="min-h-0 px-5">
          {readOnly ? (
            <div className="flex items-center gap-3 border-b border-border bg-muted/50 py-1.5 text-xs">
              <span>This thread is open in another tab — read-only here.</span>
              <button
                type="button"
                className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
                onClick={takeOverThread}
              >
                Take over
              </button>
            </div>
          ) : statusLine ? (
            <div
              className={`border-b border-border py-1.5 text-xs ${
                debug.error || operationError ? "text-destructive" : "text-muted-foreground"
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
              onTurnChange={onTurnChange}
              onSideResize={setSideWidth}
              sideOpen={sideOpen}
              onSideOpenChange={openSide}
              sideHead={<ModeDial mode={mode} setMode={setMode} />}
              threadList={
                <ThreadList
                  threads={threads}
                  currentThreadId={currentThreadId}
                  onSelect={switchThread}
                  onNew={newThread}
                  onDelete={(id) => void deleteThread(id)}
                  onSearch={() => setPaletteOpen(true)}
                />
              }
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-4">
              <div className="pe-composer-lane">
                <div ref={composerRef} className="pointer-events-auto">
                  <Composer
                    setMode={setMode}
                    promptSeed={promptSeed}
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
                    onClick={onPluginClose}
                  >
                    <X />
                  </Button>
                </div>
              }
            >
              {/* ponytail: iframe keeps the pilot route-native; extract a shared surface when
                  cross-pane focus or a single shared browser subscription becomes necessary. */}
              <iframe
                className="size-full border-0"
                src={`/${plugin}`}
                title={chatPluginTitle(plugin)}
              />
            </SidePane>
          ) : null}
        </div>
      </div>

      <ThreadPalette
        threads={threads}
        currentThreadId={currentThreadId}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSelect={switchThread}
        onNew={newThread}
        onDelete={(id) => void deleteThread(id)}
      />
    </main>
  );
}
