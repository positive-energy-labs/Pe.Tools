/**
 * Route state — the declarative contract for a collaborative route workspace.
 *
 * A route that wants pea + human co-editing declares a zod document schema,
 * a declarative agent write mask (which paths
 * pea may propose to — everything else is human-only), and a set of named commands
 * (the side-effectful work the mask forbids doing by hand). No per-route server code
 * beyond the schema + mask + command handlers: RouteWorkspace (packages/runtime)
 * owns thread/workspace persistence, ordering, recovery, validation, and commands; the
 * three universal pea tools (route_state_read/route_state_apply/route_command) are thin
 * HTTP clients to its endpoints; the browser writes the same scoped document as `actor:"human"`
 * (unmasked) and receives document snapshots through its route-specific event stream.
 */
import { z } from "zod";

/** A named side-effectful command a route exposes. `actor:"human"` commands reject pea. */
export interface RouteStateCommandSpec {
  description: string;
  input: z.ZodType;
  actor: "any" | "human";
  /** The command may mutate an external system after route state is persisted. */
  mutatesExternal?: boolean;
  /** A successful command proves external state fresh after an uncertain mutation. */
  recoversExternal?: boolean;
}

export interface RouteStateSpec<TSchema extends z.ZodType> {
  /** Route name, e.g. `family-types` — the URL segment transport adapters key on. */
  route: string;
  /** Human-facing discovery metadata; adapters should not duplicate this. */
  title: string;
  description: string;
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
  // Every route gets the substrate-owned `bind` command; RouteWorkspace implements it
  // generically (writes doc.binding) — routes never supply a handler for it.
  return { ...spec, commands: { [BIND_COMMAND]: bindCommandSpec, ...spec.commands } };
}

/** The document type a spec's schema parses to. */
export type RouteDocOf<TSpec> =
  TSpec extends RouteStateSpec<infer TSchema> ? z.infer<TSchema> : never;

/* ── Session binding (substrate-owned doc segment) ─────────────────────────── */

/**
 * Which Revit session this workspace speaks to. Human-writable via the built-in
 * `bind` command; commands resolve `input.target ?? doc.binding.target`. An
 * unresolvable target with multiple sessions connected hard-fails host-side —
 * never a silent fallback.
 */
export const routeBindingSchema = z
  .object({
    target: z.string().nullable().default(null),
    boundAt: z.string().nullish(),
  })
  .prefault({ target: null });
export type RouteBinding = z.infer<typeof routeBindingSchema>;

export const BIND_COMMAND = "bind";

export const bindCommandSpec: RouteStateCommandSpec = {
  description:
    "HUMAN ONLY. Bind this workspace to one Revit session (e.g. 'sandbox:<id>' or 'user'); commands inherit it unless they pass their own target. target: null unbinds.",
  input: z.object({ target: z.string().nullable() }),
  actor: "human",
};

/** Per-command override wins; otherwise the workspace binding; otherwise undefined. */
export function resolveTarget(input: unknown, doc: unknown): string | undefined {
  const explicit = (input as { target?: unknown } | null | undefined)?.target;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const bound = (doc as { binding?: { target?: string | null } } | null | undefined)?.binding
    ?.target;
  return bound ?? undefined;
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

/** What a command handler receives: read the current document, write the next one. */
export interface RouteStateCommandContext<TDoc = unknown> {
  /** The current document (schema-parsed; a fresh empty document when absent). */
  getDoc(): TDoc;
  /** Replace the document (schema-validated before it lands). */
  setDoc(next: TDoc): Promise<void>;
}

export type RouteStateCommandHandler<TDoc = unknown> = (
  input: unknown,
  ctx: RouteStateCommandContext<TDoc>,
) => Promise<unknown>;
export type RouteStateCommandHandlers<TDoc = unknown> = Record<
  string,
  RouteStateCommandHandler<TDoc>
>;
