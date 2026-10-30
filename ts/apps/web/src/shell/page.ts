import type { History } from "@pe/agent-contracts";
import type { Refusal } from "../route/refusal";

/**
 * How a page move lands in history: a named move (frame, preset, a Pea patch) pushes one entry; a
 * continuous gesture (wheel, drag, orbit, typing) replaces it. `guard` drops the move when one of
 * those fields changed since the action began (a bare array is the guard alone).
 */
export interface PageMove<P> {
  readonly history?: History;
  readonly guard?: readonly (keyof P)[];
}

export type PageTransitionOrigin = "page" | "action" | "pea" | "url" | "initial";

/** Pure coupled Page rules. The owner validates the normalized patch as one complete candidate.
 * Restores reset dependents too. The owner preserves explicitly restored fields atomically;
 * evidence-dependent guards defer URL/initial membership checks until the Reading arrives.
 */
export type PageTransition<P> = (
  current: Readonly<P>,
  patch: Readonly<Partial<P>>,
  origin: PageTransitionOrigin,
) => { readonly patch: Partial<P> } | { readonly refusal: Refusal };
