import {
  routeAddress,
  type RouteView,
  type RouteViewAck,
  type RouteViewOpen,
  type RouteViewOpenIntent,
} from "@pe/agent-contracts";

type Lease = { view: RouteView; revision: number; seen: number };
type Intent = {
  type: "route-view-intent";
  route: string;
  thread: string;
  instance: string;
  commandId: string;
  revision: number;
  patch: Record<string, string>;
};
const MAX_AGE_MS = 15_000;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mounted Page state of every route that leases a view (`routeViewRoutes`), never Work. A command succeeds
 * only after the view acknowledges its render.
 */
export class RouteViewStore {
  private leases = new Map<string, Lease>();
  private listeners = new Set<(intent: Intent | RouteViewOpenIntent) => void>();
  private pending = new Map<
    string,
    {
      lease: Lease;
      patch: Record<string, string>;
      resolve: (value: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  publish(view: RouteView) {
    this.prune();
    const prior = this.leases.get(view.instance);
    const revision = prior && same(prior.view, view) ? prior.revision : (prior?.revision ?? 0) + 1;
    const lease = { view, revision, seen: Date.now() };
    this.leases.set(view.instance, lease);
    return { ...view, revision };
  }

  remove(instance: string) {
    this.leases.delete(instance);
    for (const [id, pending] of this.pending) {
      if (pending.lease.view.instance === instance)
        this.finish(id, { ok: false, error: "view unmounted" });
    }
  }

  select(thread: string, route: string, instance?: string) {
    this.prune();
    const views = [...this.leases.values()]
      .filter(
        (lease) =>
          lease.view.thread === thread &&
          lease.view.route === route &&
          Date.now() - lease.seen < MAX_AGE_MS,
      )
      .map((lease) => ({ ...lease.view, revision: lease.revision }));
    if (instance) return views.find((view) => view.instance === instance) ?? null;
    return views.length === 1
      ? views[0]
      : {
          ok: false,
          error: views.length
            ? `ambiguous mounted ${route} views`
            : `no mounted ${route} view; route:${route}.set-view asks the browser showing this conversation to open it`,
          instances: views.map((view) => view.instance),
        };
  }

  /** Commands are live delivery only. A later subscriber cannot open an old tool accidentally. */
  open(route: RouteView["route"], input: RouteViewOpen) {
    const canonical = routeAddress(route).tab(input.link);
    if (!canonical.ok) return { ok: false as const, error: canonical.error };
    const commandId = crypto.randomUUID();
    for (const listener of this.listeners)
      listener({
        type: "route-view-open",
        route,
        thread: input.thread,
        link: canonical.link,
        commandId,
      });
    return { ok: true as const, commandId };
  }

  subscribe(listener: (intent: Intent | RouteViewOpenIntent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async set(
    thread: string,
    route: string,
    instance: string,
    revision: number,
    patch: Record<string, string>,
  ) {
    const selected = this.select(thread, route, instance);
    if (!selected || "ok" in selected) return { ok: false, error: "view unavailable" };
    const lease = this.leases.get(instance)!;
    const agent = routeAddress(lease.view.route).agent;
    if (
      !agent.patch.safeParse(patch).success ||
      Object.keys(patch).some((key) => !(key in lease.view.page))
    )
      return { ok: false, error: `patch names keys Pea may not set on ${route}` };
    if (selected.revision !== revision)
      return { ok: false, error: "view changed; read it again", view: selected };
    if ([...this.pending.values()].some((entry) => entry.lease.view.instance === instance))
      return { ok: false, error: "view command already pending" };
    const settled = agent.settle(lease.view.page, patch);
    if (!settled.ok) return settled;
    if (Object.keys(settled.patch).some((key) => !(key in lease.view.page)))
      return { ok: false, error: `patch names keys Pea may not set on ${route}` };
    patch = settled.patch;
    const commandId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve) => {
      const timer = setTimeout(
        () =>
          this.finish(commandId, {
            ok: false,
            outcome: "unacknowledged",
            error: "view did not acknowledge the patch",
          }),
        8_000,
      );
      this.pending.set(commandId, { lease, patch, resolve, timer });
    });
    for (const listener of this.listeners)
      listener({ type: "route-view-intent", route, thread, instance, commandId, revision, patch });
    return result;
  }

  /**
   * The browser's answer to one pending command. A stale or foreign answer (no pending command, or
   * another instance or revision) settles nothing. A refusal settles only when the page it reports
   * is the page Pea leased and still the current lease page, on the same thread and context: the
   * patch was refused whole. If the view moved meanwhile, the command ends `stale` now.
   */
  ack(input: RouteViewAck) {
    const pending = this.pending.get(input.commandId);
    if (
      !pending ||
      pending.lease.view.instance !== input.instance ||
      pending.lease.revision !== input.revision
    )
      return { ok: false, error: "stale view command" };
    const current = this.leases.get(input.instance)?.view;
    const sameView =
      !!current &&
      current.thread === pending.lease.view.thread &&
      same(current.context, pending.lease.view.context);
    if (input.outcome === "refused") {
      if (
        !sameView ||
        !same(input.page, pending.lease.view.page) ||
        !same(input.page, current.page)
      ) {
        this.finish(input.commandId, {
          ok: false,
          outcome: "stale",
          error: "view changed while the patch was refused; read it again",
          ...(current ? { view: current } : {}),
        });
        return { ok: false, error: "view changed before the refusal was reported" };
      }
      this.finish(input.commandId, {
        ok: false,
        outcome: "refused",
        refusal: input.refusal,
        instance: input.instance,
        revision: input.revision,
        page: input.page,
      });
      return { ok: true };
    }
    if (
      !sameView ||
      !same(current.page, input.page) ||
      !same(current.facts, input.facts) ||
      Object.entries(pending.patch).some(([key, value]) => input.page[key] !== value)
    )
      return { ok: false, error: "view context changed before acknowledgement" };
    this.finish(input.commandId, {
      ok: true,
      outcome: "rendered",
      page: input.page,
      facts: input.facts,
      instance: input.instance,
    });
    return { ok: true };
  }

  private finish(id: string, result: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(result);
  }

  private prune() {
    for (const [instance, lease] of this.leases) {
      if (Date.now() - lease.seen >= MAX_AGE_MS) this.remove(instance);
    }
  }
}
