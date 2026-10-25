import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useRouterState } from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { ChatShell } from "#/chat/chat-shell";
import { PaneSplit } from "@pe/kit/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabs, tabTitle } from "./route-tabs";
import { Button } from "@pe/kit/lang/button";
import { PanelLeftClose, PanelRightClose } from "lucide-react";
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
  // Either side folds to a rail; folding one opens the other, so the dock never draws two rails.
  const [folded, setFolded] = useState<"route" | "chat" | null>(null);
  const fold = (side: "route" | "chat") => (collapsed: boolean) =>
    setFolded(collapsed ? side : null);
  const both = Boolean(tabs.route);
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
        >
          {both && (
            <span className="ml-auto flex shrink-0 gap-1">
              <Button
                icon={PanelLeftClose}
                label="Collapse the Place"
                aria-pressed={folded === "route"}
                onClick={() => setFolded(folded === "route" ? null : "route")}
              />
              <Button
                icon={PanelRightClose}
                label="Collapse the chat"
                aria-pressed={folded === "chat"}
                onClick={() => setFolded(folded === "chat" ? null : "chat")}
              />
            </span>
          )}
        </RouteTabs>
      )}
      <ChatPlanIntent.Provider value={intent}>
        {/* Pea and tool pages share this owner so navigation cannot destroy unsent drafts. */}
        <PaneSplit
          axis={narrow ? "vertical" : "horizontal"}
          grow
          hide={both ? undefined : "start"}
          resize={
            folded === "route"
              ? {
                  // The Place folds through the same split: the rail is the start side while it
                  // is folded, and the chat's track returns when it opens.
                  target: "start",
                  defaultSize: 32,
                  minSize: 32,
                  collapse: {
                    collapsed: true,
                    onCollapsedChange: fold("route"),
                    collapsedSize: 32,
                    title: "places",
                    head: tabs.tabs.map((tab) => (
                      <Button
                        key={tab.id}
                        label={tabTitle(tab)}
                        aria-pressed={tabs.active?.id === tab.id}
                        onClick={() => {
                          setFolded(null);
                          void tabs.select(tab);
                        }}
                      >
                        {tabTitle(tab)}
                      </Button>
                    )),
                  },
                }
              : {
                  target: "end",
                  defaultSize: narrow ? 280 : 400,
                  minSize: narrow ? 180 : 300,
                  minOtherSize: narrow ? 200 : 360,
                  collapse: {
                    collapsed: folded === "chat",
                    onCollapsedChange: fold("chat"),
                    collapsedSize: 32,
                    collapseBelow: 240,
                    title: "thread",
                  },
                }
          }
          start={<RouteRetention {...tabs} renderRoute={renderRoute} />}
          end={
            tabs.route || pea ? (
              <ChatShell docked={Boolean(tabs.route)} target={tabs.target} />
            ) : (
              children
            )
          }
        />
      </ChatPlanIntent.Provider>
    </div>
  );
}
