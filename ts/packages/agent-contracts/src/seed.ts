/**
 * Seed — one moment of a route, Layer-free: the Work it starts from, a value per Reading key, a
 * partial Page, and an optional injected failure. A Seed is what `?demo=<action>` mounts in an
 * isolated owner, and what the inspector exports.
 */
import type { ExecutionTarget } from "./target.ts";

/** One moment of a route: section 3 of the route-primitive spec. */
export interface Seed<W, R extends string, P> {
  title: string;
  /** Explicit synthetic authority for this moment. Absent seeds are host-only. */
  target?: ExecutionTarget;
  work: W;
  readings: Partial<Record<R, unknown>>;
  page: Partial<P>;
  /** Failure injection for the demo lane: the action that refuses, and what it says. */
  failure?: { action: string; message: string };
}
