import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { routeAddress, split, pane } from "@pe/agent-contracts";
import { ChatShell } from "#/chat/chat-shell";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { chipRecipe } from "@pe/kit/lang/chip";
import { useThreadWorks } from "#/chat/thread-work";
import {
  GraphLayoutView,
  type GraphLayoutState,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabActions, RouteTabs } from "./route-tabs";
import { RouteRetention } from "./route-retention";

/** Under these a side folds to its rail: Pea reads thin, a tool needs room for its table. */
const DOCK_FLOOR = { pea: 280, tools: 420 };

/** Pea starts, connected tools end. Retained route bodies stay mounted behind the tools rail. */
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
  const [layout, setLayout] = useState<GraphLayoutState>({ tools: { folded: !tabs.route } });
  useEffect(
    () =>
      setLayout((prior) => ({
        ...prior,
        tools: { ...prior.tools, folded: !tabs.route },
        pea: { ...prior.pea, folded: false },
      })),
    [tabs.route, tabs.active?.id],
  );
  const failure = tabs.failure ?? planRefusal?.message ?? null;
  // A Work pressed on a closed document: its tool says what was kept and how to reconnect, while
  // the source row's remembered Work still finds that document closed. It follows the Place the
  // press opened, whatever conversation is selected.
  const navigate = useNavigate();
  const closed = useAtomValue(store.atoms.closedWork);
  const works = useThreadWorks();
  const reconnect =
    closed &&
    closed.place !== undefined &&
    closed.place === tabs.active?.id &&
    works.of.get(closed.thread)?.documents.find((doc) => doc.id === closed.documentId)
      ?.availability !== "open"
      ? closed
      : null;
  const active = tabs.active?.id ?? null;
  const strip = (
    <RouteTabs
      tabs={tabs.tabs}
      active={active}
      onSelect={(tab) => void tabs.select(tab)}
      onClose={(tab) => void tabs.close(tab)}
    />
  );
  return (
    <ChatPlanIntent.Provider value={intent}>
      {/* Pea and tool pages share this owner so navigation cannot destroy unsent drafts. */}
      <GraphLayoutView
        layout={split(
          "route-dock",
          {
            axis: "h",
            sized: "end",
            size: 720,
            minSize: DOCK_FLOOR.tools,
            minOtherSize: DOCK_FLOOR.pea,
            persist: "pe.toolsWidth",
          },
          pane("pea"),
          pane("tools"),
        )}
        panes={{
          pea: {
            label: "pea",
            purpose: "Conversation",
            draws: [],
            verbs: [],
            frame: { header: false, flush: true, scroll: "clip" },
          },
          tools: {
            label: "tools",
            purpose: "Retained tool routes",
            draws: [],
            verbs: [],
            frame: { flush: true, scroll: "clip" },
          },
        }}
        active={() => true}
        state={{ panes: layout, onChange: setLayout }}
        bodies={{
          pea: (frame) =>
            frame(
              tabs.route || pea ? (
                <ChatShell docked={Boolean(tabs.route)} target={tabs.target} />
              ) : (
                children
              ),
            ),
          tools: (frame) =>
            frame(
              <>
                {reconnect && (
                  <ClosedWorkBand
                    closed={reconnect}
                    onOpen={() => void navigate({ to: "/open" })}
                  />
                )}
                <RouteRetention {...tabs} renderRoute={renderRoute} />
              </>,
              {
                tabs: strip,
                actions: (
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
                ),
              },
            ),
        }}
      />
    </ChatPlanIntent.Provider>
  );
}

/** Retained Work for a closed document, saved or never saved: its name, what is kept, the one way
 *  back, and the host's reason. Nothing promises the same file reopens, and the Work never moves
 *  to a replacement document; the tool's verbs stay refused while it is closed. */
function ClosedWorkBand({
  closed,
  onOpen,
}: {
  closed: { document: string | null; intent: string; unfinished: number; reason: string | null };
  onOpen: () => void;
}) {
  return (
    <div data-closed-work="" className="flex shrink-0 flex-col gap-1 p-(--gutter) hairline-b">
      <EmptyState story="scope" exit="reconnect in Revit">
        {`${closed.document ?? "Its document"} is closed`}
      </EmptyState>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {closed.unfinished ? (
          <span className={chipRecipe().base()}>{closed.unfinished} unfinished</span>
        ) : null}
        <span className="min-w-0 truncate">{closed.intent}</span>
        <Button kind="framed" label="Open or choose a document in Revit" onClick={onOpen}>
          Open in Revit…
        </Button>
      </span>
      <p className="m-0 t-small text-ink-mute">
        Work is kept, read-only, while its document is closed.
      </p>
      {closed.reason ? <p className="m-0 t-small text-ink-mute">{closed.reason}</p> : null}
    </div>
  );
}
