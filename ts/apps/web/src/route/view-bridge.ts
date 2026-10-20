/**
 * The one browser half of Pea's route-view channel (`routeViews` in agent-contracts). A route that
 * opts in mounts this hook with the Page keys it lets Pea set, what it shows, and how to apply a
 * patch through its own Page. The hook leases the visible view to the host, takes Pea's patch from
 * the event stream, and acknowledges only after the patched Page has rendered. No Page field enters
 * authored Work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteView, RouteViewRoute } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { useHostEvents } from "#/readings";

type Intent = {
  type: "route-view-intent";
  route: string;
  thread: string;
  instance: string;
  commandId: string;
  revision: number;
  patch: Record<string, string>;
};

export function useRouteViewBridge({
  route,
  thread,
  surface,
  visible,
  page,
  apply,
  context,
  facts,
}: {
  route: RouteViewRoute;
  thread?: string;
  surface: "chat" | "route";
  /** False while the route shows nothing Pea could address (no thread, hidden, or a stage with no view). */
  visible: boolean;
  /** The current values of the settable keys, exactly `routeViews[route].set`'s keys. */
  page: Record<string, string>;
  /** Applies Pea's patch through the route's Page; the URL follows from the route's own sync. */
  apply: (patch: Record<string, string>) => void;
  /** Identity of what is shown; an ack fails if it moves while a command is pending. */
  context: Record<string, unknown>;
  /** What the shown Page derives; the ack echoes it. */
  facts: Record<string, unknown>;
}) {
  const instance = useRef(crypto.randomUUID());
  const revision = useRef<number | null>(null);
  const published = useRef<RouteView | null>(null);
  const publishing = useRef<Promise<void>>(Promise.resolve());
  const leased = useRef(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const raw: RouteView | null =
    thread && visible && pageVisible
      ? { route, thread, instance: instance.current, surface, page, context, facts }
      : null;
  const viewKey = JSON.stringify(raw);
  const view = useMemo(() => JSON.parse(viewKey) as RouteView | null, [viewKey]);
  const current = useRef(view);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  current.current = view;
  const publish = useCallback((value: RouteView) => {
    const next = publishing.current
      .catch(() => {})
      .then(async () => {
        const accepted = (await peClient.call("view.publish", {
          params: { route: value.route },
          body: value,
        })) as { revision: number };
        leased.current = true;
        if (current.current === value) {
          revision.current = accepted.revision;
          published.current = value;
        }
      });
    publishing.current = next;
    return next;
  }, []);
  useEffect(() => {
    if (!view) return;
    void publish(view).catch(() => {});
    const timer = setInterval(() => {
      if (current.current) void publish(current.current).catch(() => {});
    }, 5_000);
    return () => clearInterval(timer);
  }, [view, publish]);
  useEffect(
    () => () => {
      revision.current = null;
      published.current = null;
      // Release only a lease the host really took; a view that never published has nothing to remove.
      publishing.current = publishing.current
        .catch(() => {})
        .then(async () => {
          if (!leased.current) return;
          leased.current = false;
          await peClient.call(
            "view.remove",
            { params: { route, instance: instance.current } },
            { keepalive: true },
          );
        })
        .catch(() => {});
    },
    [Boolean(view)],
  );
  const onEvent = useCallback(
    (event: Intent) => {
      const value = current.current;
      if (
        event.type !== "route-view-intent" ||
        !value ||
        event.route !== value.route ||
        document.visibilityState === "hidden" ||
        event.thread !== value.thread ||
        event.instance !== value.instance ||
        event.revision !== revision.current ||
        JSON.stringify(published.current) !== JSON.stringify(value)
      )
        return;
      setIntent(event);
      applyRef.current(event.patch);
    },
    [],
  );
  useHostEvents(Boolean(view), onEvent);
  useEffect(() => {
    if (!intent || !view) return;
    if (Object.entries(intent.patch).some(([key, value]) => view.page[key] !== value)) return;
    let canceled = false;
    void publish(view)
      .then(async () => {
        if (canceled) return;
        await peClient.call("view.ack", {
          params: { route },
          body: {
            instance: instance.current,
            commandId: intent.commandId,
            revision: intent.revision,
            page: view.page,
            facts: view.facts,
          },
        });
        if (!canceled) setIntent(null);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [intent, view, publish, route]);
}
