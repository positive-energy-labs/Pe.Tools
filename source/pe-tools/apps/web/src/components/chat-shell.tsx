import { useMemo, useState } from "react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { Plus, Search } from "lucide-react";
import { selectWorkbenchChrome } from "@pe/agent-contracts";
import { Button } from "#/components/ui/button";
import { ControlChips } from "#/components/control-chips";
import { ModeDial } from "#/components/mode-dial";
import { Composer } from "#/components/composer";
import { ThreadPalette } from "#/components/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { WorkbenchRuntimeProvider } from "#/workbench/aui";
import { Lens } from "#/workbench/Lens";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import "#/workbench/lens.css";

export function ChatShell({
  initialTurn,
  onTurnChange,
  promptSeed,
}: {
  initialTurn?: number;
  onTurnChange?: (turn: number | undefined) => void;
  promptSeed?: string;
}) {
  return (
    <HotkeysProvider>
      <WorkbenchRuntimeProvider>
        <Surface initialTurn={initialTurn} promptSeed={promptSeed} onTurnChange={onTurnChange} />
      </WorkbenchRuntimeProvider>
    </HotkeysProvider>
  );
}

function Surface({
  initialTurn,
  onTurnChange,
  promptSeed,
}: {
  initialTurn?: number;
  onTurnChange?: (turn: number | undefined) => void;
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
    <main data-mode={mode} className="fixed inset-0 bg-background font-pe text-foreground">
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
          <ModeDial mode={mode} setMode={setMode} />
          <div className="flex min-w-0 items-center gap-2">
            <ControlChips />
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="Threads (Ctrl/Cmd-K)"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="size-3.5" />
              threads
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="New thread"
              onClick={newThread}
            >
              <Plus className="size-4" />
            </Button>
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

        <div className="relative min-h-0">
          {/* The Lens owns the scroller + MapDial geometry; the composer floats over its chat lane. */}
          <Lens
            state={debug.state}
            mode={mode}
            initialTurn={initialTurn}
            scrollKey={currentThreadId}
            onTurnChange={onTurnChange}
          />
          {/* The context ribbon + composer float over the CHAT lane only (pe-composer-lane clears
              the side lanes + mapdial) and resize with it. The ribbon is the unified request-
              ordered token budget bar, spanning the input width directly above it. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-4">
            <div className="pe-composer-lane px-4">
              <div className="pointer-events-auto flex flex-col gap-2">
                <ContextRibbon
                  breakdown={breakdown}
                  cache={cache}
                  onOpenWorld={() => setMode("world")}
                />
                <Composer setMode={setMode} promptSeed={promptSeed} />
              </div>
            </div>
          </div>
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
