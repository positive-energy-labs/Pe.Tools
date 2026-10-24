import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useRouterState } from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { ChatShell } from "#/chat/chat-shell";
import { EmptyState } from "@pe/kit/lang/empty";
import { Pane, PaneSplit } from "@pe/kit/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabActions, RouteTabs } from "./route-tabs";
import { RouteRetention } from "./route-retention";

/** Collapsed tools keep only their header: one bar of labelled tabs. */
const TOOLS_BAR = { horizontal: 280, vertical: 40 };

/** Pea starts, connected tools end. The URL is the one state: a tool route expands the tools,
 *  `/pea` collapses them; retained route bodies keep their Page and DOM either way. */
export function RouteDock({
  children,
  renderRoute,
}: {
  children: ReactNode;
  renderRoute: (body: ReactNode) => ReactNode;
}) {
  const { store } = useWorkbench();
  const tabs = useRouteTabs();
  const pea = useRouterState({
    select: (state) => state.location.pathname === routeAddress("pea").path,
  });
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
  const failure = tabs.failure ?? planRefusal?.message ?? null;
  const tools = Boolean(tabs.route || tabs.tabs.length || failure);
  const active = tabs.active?.id ?? null;
  return (
    <ChatPlanIntent.Provider value={intent}>
      {/* Pea and tool pages share this owner so navigation cannot destroy unsent drafts. */}
      <PaneSplit
        axis={narrow ? "vertical" : "horizontal"}
        grow
        hide={tools ? undefined : "end"}
        resize={{
          target: "end",
          defaultSize: narrow ? 320 : 720,
          minSize: narrow ? 180 : 360,
          minOtherSize: narrow ? 200 : 360,
          persist: narrow ? undefined : "pe.toolsWidth",
          collapse: {
            collapsed: !tabs.route,
            onCollapsedChange: (collapsed) => (collapsed ? void tabs.chat() : tabs.resume()),
            collapsedSize: narrow ? TOOLS_BAR.vertical : TOOLS_BAR.horizontal,
          },
        }}
        start={
          tabs.route || pea ? <ChatShell docked={Boolean(tabs.route)} target={tabs.target} /> : children
        }
        end={
          <Pane
            id="tools"
            title="tools"
            scroll="clip"
            flush
            tabs={<RouteTabs tabs={tabs.tabs} active={active} onSelect={(tab) => void tabs.select(tab)} />}
            actions={
              <RouteTabActions
                tabs={tabs.tabs}
                active={active}
                failure={failure}
                onRetry={tabs.retry}
                onChat={() => void tabs.chat()}
                onDuplicate={tabs.active ? () => void tabs.duplicate() : null}
                onCloseActive={() => {
                  if (tabs.active) void tabs.close(tabs.active);
                }}
              />
            }
          >
            <RouteRetention {...tabs} renderRoute={renderRoute} />
            {!tabs.route && (
              <div className="grid flex-1 place-content-center p-(--gutter)">
                <EmptyState story="scope" exit="press a tab or a Work">
                  tools collapsed
                </EmptyState>
              </div>
            )}
          </Pane>
        }
      />
    </ChatPlanIntent.Provider>
  );
}
