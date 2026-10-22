import * as Atom from "effect/unstable/reactivity/Atom";
import { deepEqual } from "@tanstack/react-router";
import type { z } from "zod";
import type { PageMove } from "./manifest";
import type { createRouteOwner } from "./route-owner";
import { causeRefusal, refuse, type Refusal } from "./refusal";

type Origin = "initial" | "page" | "action" | "url" | "pea";
export interface PageSnapshot<P> {
  readonly page: P;
  readonly revision: number;
  /** User, URL and Pea moves invalidate an action's unguarded snapshot; its own moves do not. */
  readonly epoch: number;
  readonly origin: Origin;
  readonly history?: PageMove<P>["history"];
}

type IntentReceipt = {
  readonly current: () => boolean;
  readonly rendered: (page: object) => boolean;
};
type IntentOwner = { apply: (page: object, apply: () => void) => IntentReceipt | null };
const pageOwners = new WeakMap<object, IntentOwner>();

/** A bridge must obtain an accepted owner receipt before it can acknowledge a rendered patch. */
export const applyPageIntent = (page: object, apply: () => void): IntentReceipt | null =>
  pageOwners.get(page)?.apply(page, apply) ?? null;

/** One writable Page, mounted in the route's existing registry. React only subscribes. */
export function createViewOwner<P>(
  owner: Pick<ReturnType<typeof createRouteOwner>, "registry" | "owned" | "failure" | "write">,
  schema: z.ZodType<P> | undefined,
  initial: Partial<P>,
) {
  const initialPage = schema ? schema.parse(initial) : (initial as P);
  const state = owner.owned(
    "page",
    Atom.make<PageSnapshot<P>>({ page: initialPage, revision: 0, epoch: 0, origin: "initial" }),
  );
  const read = () => owner.registry.get(state);
  let disposed = false;
  let intent: { refusal: Refusal | null; writes: number } | null = null;
  const reject = (refusal: Refusal) => {
    if (intent) intent.refusal = refusal;
    if (!disposed) owner.registry.set(owner.failure, refusal);
    return refusal;
  };
  const remember = (page: P) => {
    if (page !== null && typeof page === "object") pageOwners.set(page, bridge);
  };
  const move = (
    next: Partial<P>,
    options: PageMove<P> = {},
    origin: Origin = "page",
    snapshot?: PageSnapshot<P>,
  ): Refusal | null => {
    if (disposed) return reject(refuse("not-ready", "This Page is no longer mounted"));
    const before = read();
    if (snapshot) {
      const guard = options.guard;
      if (
        guard
          ? guard.some((key) => !Object.is(before.page[key], snapshot.page[key]))
          : before.epoch !== snapshot.epoch
      )
        return null;
    }
    const candidate = { ...before.page, ...next };
    const parsed = schema?.safeParse(candidate);
    if (parsed && !parsed.success)
      return reject(
        refuse(
          "not-ready",
          `Page update refused: ${parsed.error.issues[0]?.message ?? "invalid Page"}`,
        ),
      );
    // Parsing clones containers. Share with the candidate, so untouched guards retain identity
    // while an explicitly replaced array remains a new snapshot even when its contents match.
    const page = { ...(parsed ? parsed.data : candidate) } as P;
    for (const key of Object.keys(page as object) as (keyof P)[])
      if (deepEqual(page[key], candidate[key], { ignoreUndefined: false }))
        page[key] = candidate[key];
    const source = intent ? "pea" : origin;
    const after: PageSnapshot<P> = {
      page,
      revision: before.revision + 1,
      epoch: before.epoch + (source === "action" ? 0 : 1),
      origin: source,
      history: options.history,
    };
    remember(page);
    if (intent) intent.writes += 1;
    owner.write(source, "page", () => owner.registry.set(state, after));
    return null;
  };
  const bridge: IntentOwner = {
    apply(page, apply) {
      if (disposed || read().page !== page) return null;
      const attempt = { refusal: null as Refusal | null, writes: 0 };
      intent = attempt;
      try {
        apply();
      } catch (cause) {
        reject(causeRefusal(cause));
      } finally {
        intent = null;
      }
      if (attempt.refusal || !attempt.writes) return null;
      const accepted = read();
      return {
        current: () => !disposed && read() === accepted,
        rendered: (value) => value === accepted.page,
      };
    },
  };
  remember(initialPage);
  return {
    state,
    read,
    move,
    setPage: (next: Partial<P>, options?: PageMove<P>): void => {
      move(next, options);
    },
    subscribe: (notify: () => void) => owner.registry.subscribe(state, notify),
    fail: reject,
    dispose: () => {
      disposed = true;
    },
  };
}

export type ViewOwner<P> = ReturnType<typeof createViewOwner<P>>;
