import type { FamiliesView } from "@pe/agent-contracts";

type Lease = { view: FamiliesView; revision: number; seen: number };
type Intent = {
  type: "families-view-intent";
  thread: string;
  instance: string;
  commandId: string;
  revision: number;
  query: string;
};
const MAX_AGE_MS = 15_000;

/** Mounted Page state, never Work. A command succeeds only after the view acknowledges its render. */
export class RouteViewStore {
  private leases = new Map<string, Lease>();
  private listeners = new Set<(intent: Intent) => void>();
  private pending = new Map<
    string,
    {
      lease: Lease;
      query: string;
      resolve: (value: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  publish(view: FamiliesView) {
    this.prune();
    const prior = this.leases.get(view.instance);
    const revision =
      prior && JSON.stringify(prior.view) === JSON.stringify(view)
        ? prior.revision
        : (prior?.revision ?? 0) + 1;
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

  select(thread: string, instance?: string) {
    this.prune();
    const views = [...this.leases.values()]
      .filter((lease) => lease.view.thread === thread && Date.now() - lease.seen < MAX_AGE_MS)
      .map((lease) => ({ ...lease.view, revision: lease.revision }));
    if (instance) return views.find((view) => view.instance === instance) ?? null;
    return views.length === 1
      ? views[0]
      : {
          ok: false,
          error: views.length ? "ambiguous mounted Families views" : "no mounted Families view",
          instances: views.map((view) => view.instance),
        };
  }

  subscribe(listener: (intent: Intent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setQuery(thread: string, instance: string, revision: number, query: string) {
    const selected = this.select(thread, instance);
    if (!selected || "ok" in selected) return { ok: false, error: "view unavailable" };
    const lease = this.leases.get(instance)!;
    if (selected.revision !== revision)
      return { ok: false, error: "view changed; read it again", view: selected };
    if ([...this.pending.values()].some((entry) => entry.lease.view.instance === instance))
      return { ok: false, error: "view command already pending" };
    const commandId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve) => {
      const timer = setTimeout(
        () => this.finish(commandId, { ok: false, error: "view did not acknowledge query" }),
        8_000,
      );
      this.pending.set(commandId, { lease, query, resolve, timer });
    });
    for (const listener of this.listeners)
      listener({ type: "families-view-intent", thread, instance, commandId, revision, query });
    return result;
  }

  ack(input: {
    instance: string;
    commandId: string;
    revision: number;
    query: string;
    counts: FamiliesView["counts"];
  }) {
    const pending = this.pending.get(input.commandId);
    if (
      !pending ||
      pending.lease.view.instance !== input.instance ||
      pending.lease.revision !== input.revision
    )
      return { ok: false, error: "stale view command" };
    const current = this.leases.get(input.instance)?.view;
    const context = ({ thread, instance, stage, readingId, document, work }: FamiliesView) =>
      JSON.stringify({ thread, instance, stage, readingId, document, work });
    if (
      !current ||
      context(current) !== context(pending.lease.view) ||
      current.query !== input.query ||
      pending.query !== input.query ||
      JSON.stringify(current.counts) !== JSON.stringify(input.counts)
    )
      return { ok: false, error: "view context changed before acknowledgement" };
    this.finish(input.commandId, {
      ok: true,
      query: input.query,
      counts: input.counts,
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
