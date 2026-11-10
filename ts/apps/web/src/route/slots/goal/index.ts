import type { Closer, Goal } from "@pe/agent-contracts/slots";

/*
 * The kernel seam for the goal slot (ADR 0030 rule 3; ADR 0035 rule 8). Every route draws the
 * unresolved list the same way, first, and the answer stays greyed until that list is empty.
 * Owner: slice 7, which replaces the throw and makes the ducts inbox this list.
 */

export interface GoalView<R = unknown> {
  /** What is left comes first. */
  readonly unresolved: readonly Closer[];
  readonly assumed: readonly Closer[];
  readonly next: Closer | null;
  /** The answer, greyed while anything is unresolved; an estimate names its sources. */
  readonly answer: { readonly value: R | null; readonly greyed: boolean; readonly sources: readonly string[] };
}

export function goalView<R>(goal: Goal<R>): GoalView<R> {
  void goal;
  throw Error("not implemented: slice 7 (goal slot draws the unresolved list)");
}
