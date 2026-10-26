/**
 * The one browser half of Pea's route-view channel (`routeAddress(route).agent` in agent-contracts).
 * A route mounts `useRouteLease` with its Page, what it shows and what it derives; the keys Pea may
 * set are the address's. The bridge leases the visible view to the host, takes Pea's patch from the
 * event stream, and acknowledges only after the patched Page has rendered. No Page field enters
 * authored Work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  routeAddress,
  type RoutePage,
  type RouteView,
  type RouteViewRoute,
} from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { reportFault } from "#/host/diagnostics";
import { useHostEvents } from "#/readings";
import { causeRefusal, refuse, type Refusal } from "./refusal";
import { applyPageIntent, type PageIntent } from "./view-owner";
import { useRouteCurrent, useRouteSearchSlice } from "./activity";

type Intent = {
  type: "route-view-intent";
  route: string;
  thread: string;
  instance: string;
  commandId: string;
  revision: number;
  patch: Record<string, string>;
};

/**
 * The one lease every route takes: its mounted Page (`useAddressPage`, or a `useRoute` handle's
 * `page`), what it shows (`context`) and what it derives (`facts`). Pea's patch, typed by the
 * address, lands as one pushed move (`routeAddress(route).history`: Pea's patch is a step), and the
 * bridge acknowledges only a patch the Page's owner accepted. With no thread nobody could name the
 * view, so nothing is published.
 */
export function useRouteLease<R extends RouteViewRoute, P extends object>(
  route: R,
  [page, setPage]: readonly [P, (next: Partial<P>, move: { history: "push" }) => void],
  shown: {
    /** The thread that addresses this view; omitted, the URL's `?thread` (none in a chat pane). */
    thread?: string;
    /** False where the route does not own the address (a chat pane), as `useRoute` takes it. */
    url?: boolean;
    /** False while the route shows nothing Pea could address. */
    visible?: boolean;
    /** Identity of what is shown; an ack fails if it moves while a command is pending. */
    context?: Record<string, unknown>;
    /** What the shown Page derives; Pea reads it, never sets it. */
    facts?: Record<string, unknown>;
  } = {},
) {
  const url = shown.url ?? true;
  const addressedThread = useRouteSearchSlice((search) => search.thread);
  useRouteViewBridge({
    route,
    thread: shown.thread ?? (url ? addressedThread : undefined),
    surface: url ? "route" : "chat",
    visible: shown.visible ?? true,
    page: page as Partial<RoutePage<R>>,
    apply: (patch) => setPage(patch as Partial<P>, { history: "push" }),
    context: shown.context ?? {},
    facts: shown.facts ?? {},
  });
}

function useRouteViewBridge<R extends RouteViewRoute>({
  route,
  thread,
  surface,
  visible,
  page,
  apply,
  context,
  facts,
}: {
  route: R;
  thread?: string;
  surface: "chat" | "route";
  /** False while the route shows nothing Pea could address (no thread, hidden, or a stage with no view). */
  visible: boolean;
  /** The route's Page; the lease carries its agent keys, as their codecs write them (`agent.write`). */
  page: Partial<RoutePage<R>>;
  /** Applies Pea's patch, typed (`agent.read`), through the route's Page as one pushed move. */
  apply: (patch: Partial<RoutePage<R>>) => void;
  /** Identity of what is shown; an ack fails if it moves while a command is pending. */
  context: Record<string, unknown>;
  /** What the shown Page derives; the ack echoes it. */
  facts: Record<string, unknown>;
}) {
  const routeCurrent = useRouteCurrent();
  const instance = useRef(crypto.randomUUID());
  const revision = useRef<number | null>(null);
  const published = useRef<RouteView | null>(null);
  const publishing = useRef<Promise<void>>(Promise.resolve());
  const leased = useRef(false);
  const [intent, setIntent] = useState<{
    event: Intent;
    receipt: Extract<PageIntent, { ok: true }>["receipt"];
    context: string;
  } | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    changed();
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  // A generic R defers the address's lease type, so the lease is taken over every leasing route.
  const lease = routeAddress<RouteViewRoute>(route).agent;
  // The explicit Pea open this rendered Place answers (page-local history, set by the Places'
  // route-view-open listener); MCP waits for its own id, so an older lease never satisfies it.
  const openCommandId = useRouterState({
    select: (state) =>
      (state.location.state as { __peViewOpenCommandId?: string } | undefined)
        ?.__peViewOpenCommandId,
  });
  const addressed = lease.write(page);
  const raw: RouteView | null =
    thread && visible && pageVisible && routeCurrent()
      ? {
          route,
          thread,
          instance: instance.current,
          surface,
          page: addressed,
          context,
          facts,
          ...(surface === "route" && openCommandId ? { openCommandId } : {}),
        }
      : null;
  const viewKey = JSON.stringify(raw);
  const view = useMemo(() => JSON.parse(viewKey) as RouteView | null, [viewKey]);
  const current = useRef(view);
  const currentPage = useRef(page);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  current.current = view;
  currentPage.current = page;
  const publish = useCallback(
    (value: RouteView) => {
      const next = publishing.current
        .catch(() => {})
        .then(async () => {
          if (!routeCurrent() || current.current !== value) return;
          const accepted = (await peClient.call("view.publish", {
            params: { route: value.route },
            body: value,
          })) as { revision: number };
          leased.current = true;
          if (routeCurrent() && current.current === value) {
            revision.current = accepted.revision;
            published.current = value;
          }
        })
        .catch((cause) => {
          reportFault({ code: "host.failed", routeCode: route, streamKind: "view.publish" }, cause);
          throw cause;
        });
      publishing.current = next;
      return next;
    },
    [routeCurrent, route],
  );
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
        .catch((cause) =>
          reportFault({ code: "host.failed", routeCode: route, streamKind: "view.remove" }, cause),
        );
    },
    [Boolean(view)],
  );
  const onEvent = useCallback(
    (event: Intent) => {
      const value = current.current;
      if (
        event.type !== "route-view-intent" ||
        !value ||
        !routeCurrent() ||
        event.route !== value.route ||
        document.visibilityState === "hidden" ||
        event.thread !== value.thread ||
        event.instance !== value.instance ||
        event.revision !== revision.current ||
        JSON.stringify(published.current) !== JSON.stringify(value)
      )
        return;
      // A refusal is answered at once, against the page Pea leased: the owner refused the patch whole,
      // so that page still stands; the store settles it only if it is still the current lease page.
      const refused = (refusal: Refusal) =>
        void peClient
          .call("view.ack", {
            params: { route: value.route },
            body: {
              outcome: "refused",
              instance: value.instance,
              commandId: event.commandId,
              revision: event.revision,
              page: value.page,
              refusal: {
                code: refusal.code,
                message: (refusal.message || "The Page refused the patch").slice(0, 2000),
                ...(refusal.detail ? { detail: refusal.detail.slice(0, 4000) } : {}),
              },
            },
          })
          .catch((cause) =>
            reportFault({ code: "host.failed", routeCode: route, streamKind: "view.ack" }, cause),
          );
      const agent = routeAddress(value.route).agent;
      let patch: Partial<RoutePage<R>>;
      try {
        // `value` is the view this hook published, so its route is R; `RouteView` carries any route.
        patch = agent.read(event.patch) as Partial<RoutePage<R>>;
      } catch (cause) {
        return refused(refuse("failed", causeRefusal(cause).message));
      }
      const result = applyPageIntent(currentPage.current, () => applyRef.current(patch));
      if (!result.ok) return refused(result.refusal);
      // No move: only a page that already holds the patch may acknowledge it (against the unchanged
      // snapshot); otherwise the Page did nothing Pea asked for, and says so.
      const wanted = agent.write(patch);
      if (!result.moved && Object.keys(event.patch).some((key) => value.page[key] !== wanted[key]))
        return refused(refuse("conflict", "The Page made no move for this patch"));
      setIntent({ event, receipt: result.receipt, context: JSON.stringify(value.context) });
    },
    [routeCurrent],
  );
  useHostEvents(Boolean(view), onEvent);
  useEffect(() => {
    if (!intent || !view) return;
    const { event, receipt } = intent;
    const eligible = () =>
      routeCurrent() &&
      document.visibilityState !== "hidden" &&
      receipt.current() &&
      receipt.rendered(currentPage.current) &&
      current.current === view &&
      event.thread === view.thread &&
      event.instance === view.instance &&
      JSON.stringify(view.context) === intent.context;
    if (!eligible()) return;
    // The rendered page holds the patch once each key writes back as its codec writes the decoded value.
    const wanted = lease.write(lease.read(event.patch));
    if (Object.keys(event.patch).some((key) => view.page[key] !== wanted[key])) return;
    let canceled = false;
    void publish(view)
      .then(async () => {
        if (canceled || !eligible()) return;
        await peClient
          .call("view.ack", {
            params: { route },
            body: {
              outcome: "rendered",
              instance: instance.current,
              commandId: event.commandId,
              revision: event.revision,
              page: view.page,
              facts: view.facts,
            },
          })
          .catch((cause) => {
            reportFault({ code: "host.failed", routeCode: route, streamKind: "view.ack" }, cause);
            throw cause;
          });
        if (!canceled) setIntent(null);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [intent, view, page, publish, route, lease, routeCurrent]);
}
