import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { ChatShell, SIDEBAR, ToolsBar, peaFloor } from "#/chat/chat-shell";
import { ChevronRight } from "lucide-react";
import { focusQuiet } from "@pe/kit/lib/utils";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { chipRecipe } from "@pe/kit/lang/chip";
import { useThreadWorks } from "#/chat/thread-work";
import { Pane, PaneSplit, type PaneSide } from "@pe/kit/lang/pane";
import { ChatPlanIntent } from "#/route/situation-ladder";
import { useWorkbench } from "./provider";
import { useRouteTabs } from "./tabs";
import { RouteTabActions, RouteTabs } from "./route-tabs";
import { RouteRetention } from "./route-retention";

/** Pea-primary widths (counsel's rule, re-openable by kaitpw): Pea never drops below its reading
 *  measure while the tools sit at their default; the tools take what remains, the thread sidebar
 *  folding first; the tools' floor is the kit's 36rem rung (where a Table stacks its cells).
 *  Below Pea (sidebar folded) + seam + floor the dock stacks instead of squeezing Pea. */
/** Under these a side folds to its rail: Pea reads thin, a tool needs room for its table. */
export const DOCK_FLOOR = { pea: 280, tools: 420 };

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
 *  `/pea` collapses them to their tab strip in Pea's header; retained route bodies stay mounted
 *  under the hidden side, keeping their Page and DOM either way. */
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
  // Either side folds to its kit rail under its floor (kaitpw 2026-10-24); the shared seam keeps
  // the other open. With no tool route the tools are hidden, so Pea is never folded then.
  const [fold, setFold] = useState<PaneSide | null>(null);
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
  const active = tabs.active?.id ?? null;
  const strip = (
    <RouteTabs
      tabs={tabs.tabs}
      active={active}
      onSelect={(tab) => void tabs.select(tab)}
      onClose={(tab) => void tabs.close(tab)}
    />
  );
  // Collapsed, the tools are only this bar in Pea's header: no column, no placeholder. A tab
  // press there expands them and lands focus on the tool it opened.
  const bar =
    !tabs.route && (tabs.tabs.length || failure) ? (
      <>
        <RouteTabs
          tabs={tabs.tabs}
          active={null}
          onSelect={(tab) =>
            void tabs
              .select(tab)
              .then(() => focusQuiet(document.querySelector<HTMLElement>('[data-pane-id="tools"]')))
          }
          onClose={(tab) => void tabs.close(tab)}
        />
        {failure ? (
          <RouteTabActions
            tabs={tabs.tabs}
            active={null}
            failure={failure}
            onRetry={tabs.retry}
            onChat={() => void tabs.chat()}
            onDuplicate={null}
            onCloseActive={() => {}}
          />
        ) : null}
      </>
    ) : null;
  return (
    <ChatPlanIntent.Provider value={intent}>
      <ToolsBar.Provider value={bar}>
        {/* Pea and tool pages share this owner so navigation cannot destroy unsent drafts. */}
        <PaneSplit
          axis={narrow ? "vertical" : "horizontal"}
          grow
          hide={tabs.route ? undefined : "end"}
          resize={{
            target: "end",
            defaultSize: narrow ? 320 : widths.tools,
            minSize: narrow ? 180 : DOCK_FLOOR.tools,
            minOtherSize: narrow ? 200 : DOCK_FLOOR.pea,
            persist: narrow ? undefined : "pe.toolsWidth",
            collapse: {
              collapsed: tabs.route ? fold : null,
              onCollapsedChange: setFold,
              start: { title: "pea" },
              end: { title: "tools" },
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
              // One strip at a time: here while expanded, in Pea's header while collapsed.
              tabs={tabs.route ? strip : null}
              actions={
                <>
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
                  <Button
                    icon={ChevronRight}
                    label="Collapse tools"
                    onClick={() => void tabs.chat()}
                  />
                </>
              }
            >
              {reconnect ? (
                <ClosedWorkBand closed={reconnect} onOpen={() => void navigate({ to: "/open" })} />
              ) : null}
              <RouteRetention {...tabs} renderRoute={renderRoute} />
            </Pane>
          }
        />
      </ToolsBar.Provider>
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
