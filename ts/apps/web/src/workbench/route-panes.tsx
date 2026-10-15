/**
 * Chat's plugin pane: every plugin route mounts its real route view, bound to the thread. A hosted
 * view owns no URL (the pane and its focus live in the Chat URL) and draws no document picker (the
 * target is the thread head's). Opening, switching or closing the pane is not a turn event.
 */
import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type ContextType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { ChatFocus, ChatHosted, ChatPlanIntent } from "#/route/situation-ladder";
import { HostedChrome } from "#/route/hosted-chrome";
import { SurfaceInset } from "#/components/lang/surface";
import { publicRoutes } from "#/route/builtin-routes";
import type { ChatPluginRoute } from "./chat-plugins";

/**
 * Every route opened on this page stays mounted; the pane only moves the open one into view.
 * Closing the pane is therefore not unmount: an action in flight keeps its owner, finishes into
 * the same page log, and reopening shows it (K3 lifetime; only the route's own stop cancels).
 * ponytail: every opened route stays live until Chat unmounts; evict idle ones if readings cost.
 */
export function useChatPluginHost(
  plugin: ChatPluginRoute | undefined,
  thread: string,
  intent: ContextType<typeof ChatPlanIntent> = null,
  focus: readonly string[] | null = null,
  open = true,
  /** Close and focus controls; the open route draws them in its own head. */
  chrome: ReactNode = null,
) {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  const [homes, setHomes] = useState<ReadonlyMap<ChatPluginRoute, HTMLElement>>(new Map());
  // Created after mount: the server renders no portals, and a portal's home must outlive the pane.
  useEffect(() => {
    if (plugin && !homes.has(plugin)) {
      const home = document.createElement("div");
      home.className = "flex size-full min-h-0 min-w-0 flex-col";
      setHomes(new Map(homes).set(plugin, home));
    }
  }, [plugin, homes]);
  const home = plugin && publicRoutes.get(plugin) ? homes.get(plugin) : undefined;
  const slot = (element: HTMLElement | null) => {
    if (element && home && element.firstChild !== home) element.replaceChildren(home);
  };
  const kept = [...homes].map(([route, element]) => {
    const View = publicRoutes.get(route)?.hosted;
    if (!View) return null;
    return createPortal(
      <ChatHosted.Provider value>
        <ChatPlanIntent.Provider value={intent?.route === route ? intent : null}>
          <ChatFocus.Provider value={route === plugin ? focus : null}>
            <HostedChrome.Provider value={route === plugin ? chrome : null}>
              <SurfaceInset.Provider value={false}>
                <Suspense fallback={<span>Loading route?</span>}>
                  <View thread={thread} visible={route === plugin && open} />
                </Suspense>
              </SurfaceInset.Provider>
            </HostedChrome.Provider>
          </ChatFocus.Provider>
        </ChatPlanIntent.Provider>
      </ChatHosted.Provider>,
      element,
      route,
    );
  });
  return { slot, kept };
}
