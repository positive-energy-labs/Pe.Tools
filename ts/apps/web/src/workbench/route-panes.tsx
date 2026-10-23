import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChatShell } from "#/chat/chat-shell";
import { PaneSplit } from "@pe/kit/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabs } from "./route-tabs";
import { RouteRetention } from "./route-retention";

/** The addressed tab owns the URL; visited route bodies retain their own local state. */
export function RouteDock({
  children,
  renderRoute,
}: {
  children: ReactNode;
  renderRoute: (body: ReactNode) => ReactNode;
}) {
  const { store } = useWorkbench();
  const tabs = useRouteTabs();
  const plan = useAtomValue(store.atoms.planIntent);
  const planRefusal = useAtomValue(store.atoms.planRefusal);
  const intent = useMemo(
    () =>
      plan
        ? {
            route: plan.route,
            take: () => store.actions.takePlan(plan.route),
            refused: (message: string) => store.actions.refusePlan(plan.route, message),
          }
        : null,
    [plan, store],
  );
  useEffect(() => {
    if (plan && plan.route !== tabs.route) store.actions.cancelPlan();
  }, [plan, tabs.route, store]);
  const [narrow, setNarrow] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 960px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <div className="flex size-full min-h-0 min-w-0 flex-col">
      {(tabs.thread || tabs.failure) && (
        <RouteTabs
          tabs={tabs.tabs}
          active={tabs.active?.id ?? null}
          failure={tabs.failure ?? planRefusal?.message ?? null}
          onRetry={tabs.retry}
          onSelect={(tab) => void tabs.select(tab)}
          onClose={(tab) => void tabs.close(tab)}
          onChat={() => void tabs.chat()}
          onDuplicate={tabs.active ? () => void tabs.duplicate() : null}
          onCloseActive={() => {
            if (tabs.active) void tabs.close(tabs.active);
          }}
        />
      )}
      <ChatPlanIntent.Provider value={intent}>
        <PaneSplit
          axis={narrow ? "vertical" : "horizontal"}
          grow
          hide={tabs.route ? undefined : "start"}
          resize={{
            target: "end",
            defaultSize: narrow ? 280 : 400,
            minSize: narrow ? 180 : 300,
            minOtherSize: narrow ? 200 : 360,
            // The rail is horizontal-only; a stacked (narrow) dock keeps its full height.
            collapse: narrow
              ? undefined
              : {
                  collapsed: chatCollapsed,
                  onCollapsedChange: setChatCollapsed,
                  collapsedSize: 32,
                  collapseBelow: 240,
                  title: "thread",
                },
          }}
          start={<RouteRetention {...tabs} renderRoute={renderRoute} />}
          end={tabs.route ? <ChatShell docked target={tabs.target} /> : children}
        />
      </ChatPlanIntent.Provider>
    </div>
  );
}
