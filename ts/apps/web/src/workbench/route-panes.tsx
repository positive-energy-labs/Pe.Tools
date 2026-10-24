import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { ChatShell, SIDEBAR, peaFloor } from "#/chat/chat-shell";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { chipRecipe } from "@pe/kit/lang/chip";
import { useThreadWorks } from "#/chat/thread-work";
import { Pane, PaneSplit } from "@pe/kit/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabActions, RouteTabs } from "./route-tabs";
import { RouteRetention } from "./route-retention";

/** Collapsed tools keep only their header: one bar of labelled tabs. */
const TOOLS_BAR = { horizontal: 280, vertical: 40 };

/** Pea-primary widths (counsel's rule, re-openable by kaitpw): Pea never drops below its reading
 *  measure while the tools sit at their default; the tools take what remains, the thread sidebar
 *  folding first; the tools' floor is the kit's 36rem rung (where a Table stacks its cells).
 *  Below Pea (sidebar folded) + seam + floor the dock stacks instead of squeezing Pea. */
export function dockWidths(viewport: number, rem: number, pea: number, gutter: number) {
  const floor = 36 * rem;
  const folded = pea + SIDEBAR.rail + gutter;
  const open = pea + SIDEBAR.size + gutter;
  const beside = viewport - gutter - open;
  return {
    floor,
    folded,
    stackBelow: folded + gutter + floor,
    tools: beside >= floor ? beside : viewport - gutter - folded,
  };
}
const measureDock = () => {
  const style = getComputedStyle(document.documentElement);
  return dockWidths(
    window.innerWidth,
    parseFloat(style.fontSize) || 16,
    peaFloor(),
    parseFloat(style.getPropertyValue("--gutter")) || 8,
  );
};

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
  const [widths] = useState(measureDock);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${widths.stackBelow - 1}px)`);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [widths.stackBelow]);
  const failure = tabs.failure ?? planRefusal?.message ?? null;
  // A Work pressed on a closed document: its tool says what was kept and how to reconnect, while
  // the thread's live Work still finds that document closed.
  const navigate = useNavigate();
  const closed = useAtomValue(store.atoms.closedWork);
  const works = useThreadWorks();
  const reconnect =
    closed &&
    closed.thread === tabs.thread &&
    closed.route === tabs.route &&
    works.of.get(closed.thread)?.documents.find((doc) => doc.id === closed.documentId)
      ?.availability !== "open"
      ? closed
      : null;
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
          defaultSize: narrow ? 320 : widths.tools,
          minSize: narrow ? 180 : widths.floor,
          minOtherSize: narrow ? 200 : widths.folded,
          persist: narrow ? undefined : "pe.toolsWidth",
          collapse: {
            collapsed: !tabs.route,
            onCollapsedChange: (collapsed) => (collapsed ? void tabs.chat() : tabs.resume()),
            collapsedSize: narrow ? TOOLS_BAR.vertical : TOOLS_BAR.horizontal,
          },
        }}
        start={
          tabs.route || pea ? (
            <ChatShell docked={Boolean(tabs.route)} target={tabs.target} />
          ) : (
            children
          )
        }
        end={
          <Pane
            id="tools"
            title="tools"
            scroll="clip"
            flush
            tabs={
              <RouteTabs
                tabs={tabs.tabs}
                active={active}
                onSelect={(tab) => void tabs.select(tab)}
                onClose={(tab) => void tabs.close(tab)}
              />
            }
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
            {reconnect ? (
              <ClosedWorkBand closed={reconnect} onOpen={() => void navigate({ to: "/open" })} />
            ) : null}
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

/** Retained Work for a closed document: its name, what is kept, the one way back, and the host's
 *  reason. The tool's own verbs stay refused until the document is open. */
function ClosedWorkBand({
  closed,
  onOpen,
}: {
  closed: { document: string | null; intent: string; unfinished: number; reason: string | null };
  onOpen: () => void;
}) {
  return (
    <div data-closed-work="" className="flex shrink-0 flex-col gap-1 p-(--gutter) hairline-b">
      <EmptyState story="scope" exit="open it in Revit">
        {`${closed.document ?? "Its document"} is closed`}
      </EmptyState>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {closed.unfinished ? (
          <span className={chipRecipe().base()}>{closed.unfinished} unfinished</span>
        ) : null}
        <span className="min-w-0 truncate">{closed.intent}</span>
        <Button kind="framed" label="Open the document in Revit" onClick={onOpen}>
          Open in Revit…
        </Button>
      </span>
      <p className="m-0 t-small text-ink-mute">
        Work is kept; nothing runs until the document is open.
      </p>
      {closed.reason ? <p className="m-0 t-small text-ink-mute">{closed.reason}</p> : null}
    </div>
  );
}
