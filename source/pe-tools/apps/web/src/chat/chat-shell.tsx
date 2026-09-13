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
import { ToLine } from "#/chat/scope-line";
import { RouteShell, keyMeta } from "#/route";
import { CHAT_SEED_SESSION } from "#/chat/seeds";
import { chatManifest } from "#/chat/manifest";
import { SessionBadge } from "#/chat/world-badge";
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
    session,
    world,
    operationError,
    newThread,
    openThread,
    renameThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  const demoSeed = useMemo(
    () => Boolean(new URLSearchParams(globalThis.location?.search ?? "").get("demo")),
    [],
  );
  // The route, re-declared with this thread and this session bound. `routes/chat.tsx` exports the
  // static one; the actions only become runnable once the provider has a session.
  const manifest = useMemo(
    () =>
      chatManifest({
        thread: currentThreadId ?? "",
        display: chat.display,
        // The session is the caller chat's actions run through. `?demo=` is a seeded moment with
        // no live turn to send, so it names a caller that answers and does nothing — without one
        // the seed's own action refuses "Session is not ready" and the seed proves nothing.
        session:
          session ?? (demoSeed ? (CHAT_SEED_SESSION as unknown as typeof session) : undefined),
      }),
    [currentThreadId, chat.display, session, demoSeed],
  );
  const handleRenameThread = (id: string, title: string) => void renameThread(id, title);
  const handleDeleteThread = (id: string) => void deleteThread(id);
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

  const statusLine = loading ? "Loading thread state" : (error ?? operationError);

  return (
    <main
      ref={mainRef}
      data-chat="surface"
      data-mode={mode}
      data-plugin={plugin}
      data-surface="page"
      className="fixed inset-0 font-sans text-ink"
    >
      {/* The route shell owns the whole column: its head, then the lens as its body. When no
          document is resolved the shell shows Instances in the body's place instead. */}
      <div className="h-full px-5">
        <RouteShell
          manifest={manifest}
          name={threadLabel}
          aside={
            <>
              {/* status lamp on meaning roles: running = pea acting (agent identity), waiting =
                    your call is owed (caution), error = a bridge/run error (caution — NOT the
                    alarm), idle = muted. */}
              <span
                title={status}
                className="size-2 shrink-0 rounded-full data-[s=idle]:bg-ink-mute"
                data-s={status}
                data-tone={status === "running" ? "pea" : status === "idle" ? undefined : "caution"}
                data-fill={status === "idle" ? undefined : "tone"}
              />
              <SessionBadge world={world} />
            </>
          }
        >
          <div aria-live="polite" className="min-h-0">
            {statusLine ? (
              <div
                data-tone={error || operationError ? "caution" : undefined}
                className="hairline-b py-1.5 t-small t-upper"
              >
                {statusLine}
              </div>
            ) : null}
          </div>

          <div className="relative flex min-h-0 min-w-0">
            <div className="relative min-h-0 min-w-0 flex-1">
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
                      topBar={
                        <>
                          <ToLine />
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
                onOpenChange={openPlugin}
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
