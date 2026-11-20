import * as Atom from "effect/reactivity/Atom";
import { deepEqual } from "@tanstack/react-router";
import { routeAddress, type RouteKey } from "@pe/agent-contracts";
import type { z } from "zod";
import type { PageMove, PageTransition, PageTransitionOrigin } from "#/shell/page";
import type { createRouteOwner } from "#/shell/owner";
import { causeRefusal, refuse, type Refusal } from "./refusal";

type Origin = PageTransitionOrigin;
export interface PageSnapshot<P> {
  readonly page: P;
  readonly revision: number;
  /** User, URL and Pea moves invalidate an action's unguarded snapshot; its own moves do not. */
  readonly epoch: number;
  readonly origin: Origin;
  readonly history?: PageMove<P>["history"];
}

/** One writable Page, mounted in the route's existing registry. React only subscribes. */
export function createViewOwner<P>(
  owner: Pick<ReturnType<typeof createRouteOwner>, "registry" | "owned" | "failure" | "write">,
  schema: z.ZodType<P> | undefined,
  initial: Partial<P>,
  rules: { address?: RouteKey; transition?: PageTransition<P> } = {},
) {
  const initialPage = schema ? schema.parse(initial) : (initial as P);
  const state = owner.owned(
    "page",
    Atom.make<PageSnapshot<P>>({ page: initialPage, revision: 0, epoch: 0, origin: "initial" }),
  );
  const read = () => owner.registry.get(state);
  let disposed = false;
  const reject = (refusal: Refusal) => {
    if (!disposed) owner.registry.set(owner.failure, refusal);
    return refusal;
  };
  const move = (
    next: Partial<P>,
    options: PageMove<P> = {},
    origin: Origin = "page",
    snapshot?: PageSnapshot<P>,
  ): Refusal | null => {
    if (disposed) return reject(refuse("not-ready", "This Page is no longer mounted"));
    const before = read();
    // History tagging and URL normalization can restore the current Page verbatim.
    if (
      origin === "url" &&
      Object.entries(next as object).every(([key, value]) =>
        deepEqual(before.page[key as keyof P], value, { ignoreUndefined: false }),
      )
    )
      return null;
    if (snapshot) {
      const guard = options.guard;
      if (
        guard
          ? guard.some((key) => !Object.is(before.page[key], snapshot.page[key]))
          : before.epoch !== snapshot.epoch
      )
        return null;
    }
    const source = origin;
    let patch = next;
    try {
      const normalized = rules.transition?.(before.page, next, source) ?? { patch: next };
      if ("refusal" in normalized) return reject(normalized.refusal);
      patch =
        source === "url" || source === "initial"
          ? { ...normalized.patch, ...next }
          : normalized.patch;
      if (rules.address) {
        // `rules.address` is any `RouteKey`, untied from P: the manifest's Page extends its
        // address's schema by construction (`urlPage` checks the keys at load), not by type.
        const moved = routeAddress(rules.address).transition(before.page as never, patch as never);
        if (!moved.ok) return reject(refuse("not-ready", moved.error));
        patch = moved.patch as Partial<P>;
      }
    } catch (cause) {
      return reject(causeRefusal(cause));
    }
    const candidate = { ...before.page, ...patch };
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
    const after: PageSnapshot<P> = {
      page,
      revision: before.revision + 1,
      epoch: before.epoch + (source === "action" ? 0 : 1),
      origin: source,
      history: options.history,
    };
    owner.write(after.origin, "page", () => owner.registry.set(state, after));
    return null;
  };
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
