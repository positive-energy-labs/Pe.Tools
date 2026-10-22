import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ChatShell } from "#/chat/chat-shell";
import { PaneSplit } from "#/components/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabs } from "./route-tabs";

/** The URL mounts the sole route body; chat is its sibling, never a second route renderer. */
export function RouteDock({ children }: { children: ReactNode }) {
  const { store } = useWorkbench();
  const tabs = useRouteTabs();
  const mounted = useRef({
    route: tabs.route,
    id: tabs.active?.id ?? null,
    key: tabs.route ?? "chat",
  });
  if (mounted.current.route !== tabs.route) {
    mounted.current = { route: tabs.route, id: tabs.active?.id ?? null, key: tabs.route ?? "chat" };
  } else if (tabs.active && mounted.current.id === null) {
    // Enrollment must not remount a route that already read the deep link on its first render.
    mounted.current.id = tabs.active.id;
  } else if (tabs.active && tabs.active.id !== mounted.current.id) {
    mounted.current = { route: tabs.route, id: tabs.active.id, key: tabs.active.id };
  }
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
        {tabs.route ? (
          <PaneSplit
            axis={narrow ? "vertical" : "horizontal"}
            grow
            resize={{
              target: "end",
              defaultSize: narrow ? 280 : 400,
              minSize: narrow ? 180 : 300,
              minOtherSize: narrow ? 200 : 360,
            }}
            start={
              <div key={mounted.current.key} className="size-full min-h-0 min-w-0">
                {children}
              </div>
            }
            end={<ChatShell docked target={tabs.target} />}
          />
        ) : (
          children
        )}
      </ChatPlanIntent.Provider>
    </div>
  );
}
