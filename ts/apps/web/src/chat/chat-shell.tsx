import { useEffect, useMemo, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { ModeDial } from "#/chat/mode-dial";
import { ThreadDialog, ThreadsSidebar } from "#/chat/thread-palette";
import { useWorkbench } from "#/workbench/provider";
import { useMode } from "#/workbench/use-mode";
import { MODES } from "#/workbench/depth";
import { ContextRibbon, useCacheView } from "#/workbench/world";
import { SessionStrip } from "#/workbench/world";
import { selectBreakdown, selectRunStatus } from "#/workbench/chat-state";
import { buildTraceCells, ToolCellBody, TraceCellView } from "#/workbench/lens/context-strip";
import { Press } from "#/components/lang/press";
import { X } from "lucide-react";
import { chatPluginTitle, type ChatPluginRoute } from "#/workbench/chat-plugins";
import { useChatPluginHost } from "#/workbench/route-panes";
import { ComposerHead } from "#/chat/composer-head";
import { appAtomRegistry, RouteShell, keyMeta, useRoute } from "#/route";
import { chatManifest } from "#/chat/manifest";
import "#/workbench/lens.css";
import { CurrentThreadViewOwner, useCurrentThreadView } from "#/workbench/thread-view";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface as PageSurface } from "#/components/lang/surface";
import { ThreadBody } from "#/workbench/lens/thread-body";
import { ComposerBank } from "#/chat/composer-bank";

type Plugin = { plugin?: ChatPluginRoute; focus?: string; target?: string };

export function ChatShell(props: Plugin) {
  return (
    <HotkeysProvider>
      <CurrentThreadChatSurface {...props} />
    </HotkeysProvider>
  );
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
    currentThreadId,
    prompt,
    displayKnown,
    turnFailure,
    turnFailed,
    session,
    operationError,
    sendPrompt,
    cancel,
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
        cancel,
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
      cancel,
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
  const host = useChatPluginHost(plugin, currentThreadId, intent, focusPath);

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
  const status = {
    text:
      turnFailed || turnFailure
        ? "failed"
        : !displayKnown
          ? loading
            ? "loading thread state"
            : "connecting"
          : runStatus === "waiting"
            ? "waiting for you"
            : runStatus === "running"
              ? "running"
              : "ready",
    caution: turnFailed || turnFailure !== null,
    detail: operationError ?? turnFailure?.message,
  };
  const chatColumn = (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-y-[var(--gutter)]">
      <div className="min-h-0 min-w-0 flex-1">
        <Pane
          kind="content"
          scroll="clip"
          flush
          id="transcript"
          title={threads.find((thread) => thread.id === currentThreadId)?.title ?? "thread"}
          boundaryKey={currentThreadId}
          onRetry={retryBody}
        >
          <ThreadBody bodyAtom={bodyAtom} state={chat} mode={mode} sideOpen={sideOpen} />
        </Pane>
      </div>
      <ComposerBank
        currentThreadId={currentThreadId}
        deletedThreadIds={deletedThreadIds}
        prompt={prompt}
        handle={handle}
        topBar={
          <>
            <ComposerHead handle={handle} status={status} urlTarget={target} />
            <ContextRibbon
              breakdown={breakdown}
              cache={cache}
              onOpenWorld={() => setMode("world")}
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
                      actions={
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
                            <X />
                          </Press>
                        </>
                      }
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
