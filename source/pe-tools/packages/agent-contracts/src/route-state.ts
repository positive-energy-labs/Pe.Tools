/**
 * Route state — the generic collaborative-UI primitive over AgentController session state.
 *
 * A route that wants pea + human co-editing declares ONE top-level session-state key,
 * a zod schema for the document under it, a declarative agent write mask (which paths
 * pea may propose to — everything else is human-only), and a set of named commands
 * (the side-effectful work the mask forbids doing by hand). No per-route server code
 * beyond the schema + mask + command handlers: the dispatcher (packages/runtime)
 * enforces the mask, validates every write against the schema, and runs commands; the
 * three universal pea tools (route_state_read/route_state_apply/route_command) are thin
 * HTTP clients to its endpoints; the browser writes the same document as `actor:"human"`
 * (unmasked) and receives every change through the native `state_changed` event.
 */
import { z } from "zod";

/** A named side-effectful command a route exposes. `actor:"human"` commands reject pea. */
export interface RouteStateCommandSpec {
  description: string;
  input: z.ZodType;
  actor: "any" | "human";
}

export interface RouteStateSpec<TSchema extends z.ZodType> {
  /** Route name, e.g. `family-types` — the URL segment the dispatcher endpoints key on. */
  route: string;
  /** Top-level session-state key, namespaced `route:<name>` to coexist with harness keys. */
  key: string;
  schema: TSchema;
  /**
   * Segment-array patterns authorizing agent writes. `"*"` matches exactly one segment;
   * a pattern authorizes its whole subtree. Default-deny: a patch whose path matches no
   * pattern is rejected. Human writes bypass the mask entirely.
   */
  agentWriteMask: string[][];
  commands: Record<string, RouteStateCommandSpec>;
}

export function defineRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
): RouteStateSpec<TSchema> {
  return spec;
}

/** Parse a route's slice out of a raw session-state map; null when absent or invalid. */
export function readRouteState<TSchema extends z.ZodType>(
  sessionState: Record<string, unknown> | undefined,
  spec: RouteStateSpec<TSchema>,
): z.infer<TSchema> | null {
  const raw = sessionState?.[spec.key];
  if (raw == null) return null;
  const result = spec.schema.safeParse(raw);
  return result.success ? result.data : null;
}
