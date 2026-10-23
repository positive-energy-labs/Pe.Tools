import {
  Activity,
  Suspense,
  memo,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { THREAD_TABS_MAX, routeAddress, type RouteKey, type ThreadTab } from "@pe/agent-contracts";
import { RouteActivity, type RouteActivityScope } from "#/route/activity";
import { currentLocation } from "#/route/url";
import { PaneErrorBoundary } from "#/components/lang/pane";

interface RetainedRoute {
  key: string;
  thread: string;
  id: string | null;
  route: RouteKey;
  source: string;
  visible: boolean;
  Component: ComponentType;
  scope: RouteActivityScope;
  unmarkedEntry: object;
  dispose(): void;
}

/** This component is outside Activity: hiding disconnects route effects, closing disposes owners. */
const RetainedPane = memo(function RetainedPane({
  entry,
  visible,
  renderRoute,
}: {
  entry: RetainedRoute;
  visible: boolean;
  renderRoute: (body: ReactNode) => ReactNode;
}) {
  const disposal = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (disposal.current) clearTimeout(disposal.current);
    return () => {
      disposal.current = setTimeout(() => entry.dispose(), 0);
    };
  }, [entry]);
  const Component = entry.Component;
  return (
    <RouteActivity.Provider value={entry.scope}>
      <Activity mode={visible ? "visible" : "hidden"}>
        <div
          className="size-full min-h-0 min-w-0 overflow-auto"
          data-route-tab={entry.id ?? "enrolling"}
        >
          <PaneErrorBoundary>
            <Suspense fallback={null}>{renderRoute(<Component />)}</Suspense>
          </PaneErrorBoundary>
        </div>
      </Activity>
    </RouteActivity.Provider>
  );
});

/** Retain only visited leaf components. A retained Outlet would follow the active router. */
export function RouteRetention({
  route,
  thread,
  active,
  tabs,
  ready,
  promotedFrom,
  renderRoute,
}: {
  route: RouteKey | null;
  thread: string;
  active: { id: string } | null;
  tabs: readonly ThreadTab[];
  ready: boolean;
  promotedFrom?: string;
  renderRoute: (body: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const tagged = (
    location.state as { __peRouteTab?: { id: string; thread: string; route: string } }
  ).__peRouteTab;
  // History identifies the initial tab before the thread summary has enrolled its strip.
  const selectedId =
    active?.id ?? (tagged?.thread === thread && tagged.route === route ? tagged.id : null);
  const retained = useRef<RetainedRoute[]>([]);
  const priorThread = retained.current[0]?.thread;
  const promotion = priorThread !== undefined && promotedFrom === priorThread;
  const enrollment = priorThread === "" && Boolean(thread);
  if (priorThread !== undefined && priorThread !== thread && !promotion && !enrollment)
    retained.current = [];
  for (const entry of retained.current) {
    entry.visible = false;
    if (promotion || enrollment) {
      entry.thread = thread;
      entry.scope.search = { ...entry.scope.search, thread };
    }
  }
  retained.current = retained.current.filter((entry) =>
    entry.id
      ? !ready || entry.id === selectedId || tabs.some((tab) => tab.id === entry.id)
      : entry.route === route,
  );
  if (route) {
    const pathname = routeAddress(route).path;
    const search = location.search as Record<string, unknown>;
    const source = JSON.stringify([search.demo ?? null, search.live ?? null]);
    let entry = retained.current.find(
      (item) =>
        item.route === route &&
        (selectedId ? item.id === selectedId || item.id === null : item.id === null),
    );
    if (entry && entry.source !== source) {
      retained.current = retained.current.filter((item) => item !== entry);
      entry = undefined;
    }
    if (!entry) {
      const Component = router.routesById[pathname]?.options.component;
      if (!Component) throw Error(`No route component registered for ${pathname}`);
      const owners = new Set<{ dispose(): void }>();
      const disposed = new WeakSet<object>();
      const disposeOwner = (owner: { dispose(): void }) => {
        if (disposed.has(owner)) return;
        disposed.add(owner);
        owner.dispose();
      };
      const next: RetainedRoute = {
        key: crypto.randomUUID(),
        thread,
        id: selectedId,
        route,
        source,
        visible: true,
        Component,
        unmarkedEntry: router.history.location.state,
        scope: {
          pathname,
          search: location.search,
          current: () => {
            if (!next.visible) return false;
            const at = currentLocation(router);
            const tab = (at.state as { __peRouteTab?: { id: string; thread: string } })
              .__peRouteTab;
            return (
              at.pathname === pathname &&
              (at.search.thread ?? "") === next.thread &&
              (tab
                ? tab.id === next.id && tab.thread === next.thread
                : router.history.location.state === next.unmarkedEntry)
            );
          },
          retain: (owner) => {
            owners.add(owner);
          },
          retire: (owner) => {
            owners.delete(owner);
            disposeOwner(owner);
          },
        },
        dispose: () => {
          next.visible = false;
          for (const owner of owners) disposeOwner(owner);
          owners.clear();
        },
      };
      // Typed/deep links can arrive before the host refuses an extra tab. Keep memory bounded too.
      retained.current = retained.current.slice(-(THREAD_TABS_MAX - 1));
      retained.current.push(next);
      entry = next;
    }
    entry.id = selectedId ?? entry.id;
    entry.visible = true;
    entry.unmarkedEntry = router.history.location.state;
    entry.scope.search = location.search;
  }
  return retained.current.map((entry) => (
    <RetainedPane key={entry.key} entry={entry} visible={entry.visible} renderRoute={renderRoute} />
  ));
}
