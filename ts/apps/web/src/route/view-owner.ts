import * as Atom from "effect/unstable/reactivity/Atom";
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

type IntentReceipt = {
  readonly current: () => boolean;
  readonly rendered: (page: object) => boolean;
};
/**
 * One Pea intent's outcome. `moved`: the owner committed one coupled move. Not moved: the patch made
 * no move, and the receipt holds only while the Page is still the unchanged snapshot it was applied
 * to (the bridge acknowledges it only if that page already holds the patch). Refused: the owner's
 * own refusal, whole; nothing was committed.
 */
export type PageIntent =
  | { readonly ok: true; readonly moved: boolean; readonly receipt: IntentReceipt }
  | { readonly ok: false; readonly refusal: Refusal };
type IntentOwner = { apply: (page: object, apply: () => void) => PageIntent };
const pageOwners = new WeakMap<object, IntentOwner>();

/** A bridge must obtain an accepted owner receipt before it can acknowledge a rendered patch. */
export const applyPageIntent = (page: object, apply: () => void): PageIntent =>
  pageOwners.get(page)?.apply(page, apply) ?? {
    ok: false,
    refusal: refuse("not-ready", "This Page is no longer the one Pea leased"),
  };

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
  let intent: {
    refusal: Refusal | null;
    attempted: boolean;
    edit: PageSnapshot<P> | null;
  } | null = null;
  const reject = (refusal: Refusal) => {
    if (intent) intent.refusal = refusal;
    if (!disposed) owner.registry.set(owner.failure, refusal);
    return refusal;
  };
  const remember = (page: P) => {
    if (page !== null && typeof page === "object") pageOwners.set(page, bridge);
  };
  const commit = (after: PageSnapshot<P>) => {
    remember(after.page);
    owner.write(after.origin, "page", () => owner.registry.set(state, after));
  };
  const move = (
    next: Partial<P>,
    options: PageMove<P> = {},
    origin: Origin = "page",
    snapshot?: PageSnapshot<P>,
  ): Refusal | null => {
    if (disposed) return reject(refuse("not-ready", "This Page is no longer mounted"));
    if (intent) {
      if (intent.attempted)
        return reject(refuse("not-ready", "A Pea intent must use one coupled Page transition"));
      intent.attempted = true;
    }
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
    const source = intent ? "pea" : origin;
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
    if (intent) intent.edit = after;
    else commit(after);
    return null;
  };
  const bridge: IntentOwner = {
    apply(page, apply) {
      if (intent)
        return {
          ok: false,
          refusal: reject(refuse("not-ready", "A Pea intent cannot contain another intent")),
        };
      const before = read();
      if (disposed || before.page !== page)
        return {
          ok: false,
          refusal: refuse("not-ready", "This Page is no longer the one Pea leased"),
        };
      const attempt = {
        refusal: null as Refusal | null,
        attempted: false,
        edit: null as PageSnapshot<P> | null,
      };
      intent = attempt;
      try {
        apply();
      } catch (cause) {
        reject(causeRefusal(cause));
      } finally {
        intent = null;
      }
      if (attempt.refusal) return { ok: false, refusal: attempt.refusal };
      if (disposed)
        return { ok: false, refusal: refuse("not-ready", "This Page is no longer mounted") };
      if (!attempt.edit)
        return {
          ok: true,
          moved: false,
          receipt: {
            current: () => !disposed && read() === before,
            rendered: (value) => value === before.page,
          },
        };
      const accepted = attempt.edit;
      commit(accepted);
      return {
        ok: true,
        moved: true,
        receipt: {
          current: () => !disposed && read() === accepted,
          rendered: (value) => value === accepted.page,
        },
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
