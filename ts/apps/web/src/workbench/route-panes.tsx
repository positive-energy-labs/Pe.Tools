/**
 * Chat's plugin pane: every plugin route mounts its real route view, bound to the thread. A hosted
 * view owns no URL (the pane and its focus live in the Chat URL) and draws no document picker (the
 * target is the thread head's). Opening, switching or closing the pane is not a turn event.
 */
import { useEffect, useState, type ContextType, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import { FamilyRouteView } from "#/family/live";
import { ChatFocus, ChatHosted, ChatPlanIntent } from "#/route/situation-ladder";
import { PodsRouteContent } from "#/routes/pods";
import { FamiliesRouteContent } from "#/routes/families";
import { ParameterLinksRouteContent } from "#/routes/parameter-links";
import { TakeoffsPane } from "#/takeoff/pane";
import { InstancesPage } from "#/instances/route";
import type { ChatPluginRoute } from "./chat-plugins";

type View = (props: { thread: string; visible: boolean }) => ReactNode;

const views: Record<ChatPluginRoute, View> = {
  instances: () => <HostedInstances />,
  takeoffs: ({ thread }) => <TakeoffsPane thread={thread} />,
  family: ({ thread }) => <FamilyRouteView thread={thread} url={false} />,
  families: ({ thread, visible }) => (
    <FamiliesRouteContent thread={thread} visible={visible} surface="chat" />
  ),
  pods: ({ thread }) => <HostedPods thread={thread} />,
  "parameter-links": ({ thread }) => <ParameterLinksRouteContent thread={thread} />,
  schedules: ({ thread }) => <LiveScheduleGridWorkspace framed url={false} thread={thread} />,
};

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
) {
  const [homes, setHomes] = useState<ReadonlyMap<ChatPluginRoute, HTMLElement>>(new Map());
  // Created after mount: the server renders no portals, and a portal's home must outlive the pane.
  useEffect(() => {
    if (plugin && !homes.has(plugin)) {
      const home = document.createElement("div");
      home.className = "flex size-full min-h-0 min-w-0 flex-col";
      setHomes(new Map(homes).set(plugin, home));
    }
  }, [plugin, homes]);
  const home = plugin ? homes.get(plugin) : undefined;
  const slot = (element: HTMLElement | null) => {
    if (element && home && element.firstChild !== home) element.replaceChildren(home);
  };
  const kept = [...homes].map(([route, element]) => {
    const View = views[route];
    return createPortal(
      <ChatHosted.Provider value>
        <ChatPlanIntent.Provider value={intent?.route === route ? intent : null}>
          <ChatFocus.Provider value={route === plugin ? focus : null}>
            <View thread={thread} visible={route === plugin && open} />
          </ChatFocus.Provider>
        </ChatPlanIntent.Provider>
      </ChatHosted.Provider>,
      element,
      route,
    );
  });
  return { slot, kept };
}

function HostedInstances() {
  const [target, setTarget] = useState("");
  return <InstancesPage target={target} setTarget={setTarget} />;
}

function HostedPods({ thread }: { thread: string }) {
  const [ref, select] = useState<{ pod?: string; path?: string }>({});
  return <PodsRouteContent {...ref} thread={thread} select={select} />;
}
