/**
 * Route state — the declarative contract for a collaborative route workspace.
 *
 * A route that wants pea + human co-editing declares a zod document schema,
 * a declarative agent write mask (which paths
 * pea may propose to — everything else is human-only), and a set of named commands
 * (the side-effectful work the mask forbids doing by hand). No per-route server code
 * beyond the schema + mask + command handlers: RouteWorkspace (packages/runtime)
 * owns document persistence, ordering, recovery, validation, and commands; the
 * three universal pea tools (route_state_read/route_state_apply/route_command) are thin
 * HTTP clients to its endpoints; the browser writes the same scoped document as `actor:"human"`
 * (unmasked) and receives document snapshots through its route-specific event stream.
 */
import { z } from "zod";
import { emptyScope, scopeKey, scopeSchema, type Scope } from "./scope.ts";

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
  schema: TSchema;
  /**
   * Segment-array patterns authorizing agent writes. `"*"` matches exactly one segment;
   * a pattern authorizes its whole subtree. Default-deny: a patch whose path matches no
   * pattern is rejected. Human writes bypass the mask entirely.
   */
  agentWriteMask: string[][];
  commands: Record<string, RouteStateCommandSpec>;
}

/** A route document lives under a chat Scope (session + document) or a named standalone workspace. */
export type RouteScope =
  | { scope: Scope; workspaceId?: never }
  | { workspaceId: string; scope?: never };
export const routeScopeKey = (scope: RouteScope): string =>
  scope.workspaceId !== undefined ? `workspace:${scope.workspaceId}` : scopeKey(scope.scope);
export const routeScopeSchema = z.union([
  z.object({ scope: scopeSchema }),
  z.object({ workspaceId: z.string().trim().min(1).max(200) }),
]);
/** The Scope a route command runs under; workspace routes carry the empty Scope. */
export const scopeOfRoute = (scope: RouteScope): Scope => scope.scope ?? emptyScope;

/** The document type a spec's schema parses to. */
export type RouteDocOf<TSpec> =
  TSpec extends RouteStateSpec<infer TSchema> ? z.infer<TSchema> : never;

/** A single segment-array patch. Omit `value` to delete the key. */
export const routeStatePatchSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
export type RouteStatePatch = z.infer<typeof routeStatePatchSchema>;

export type RouteWriteKind = "error" | "refused" | "advisory" | "partial";

export type RouteStateWriteResult =
  | { ok: true; revision: number; doc?: unknown; result?: unknown }
  | {
      ok: false;
      kind: RouteWriteKind;
      error: string;
      hint: string;
      code?: import("./route-doc.ts").RouteRefusalCode;
      revision?: number;
    };

/* ── Bindings (substrate-owned doc segment) ────────────────────────────────── */

/** A route document's named external bindings (a profile, a settings file). The Revit session is
 * never a binding: it is the Scope the document is keyed under. */
export const bindSchema = z.object({ id: z.string(), label: z.string() });
export type Bind = z.infer<typeof bindSchema>;
export const routeBindingsSchema = z.object({}).catchall(bindSchema).default({});

/** Parse a raw route document; null when absent or invalid. */
export function parseRouteDoc<TSchema extends z.ZodType>(
  raw: unknown,
  spec: RouteStateSpec<TSchema>,
): z.infer<TSchema> | null {
  if (raw == null) return null;
  const result = spec.schema.safeParse(raw);
  return result.success ? result.data : null;
}

/** What a command handler receives: read the current document, write the next one. */
export interface RouteStateCommandContext<TDoc = unknown> {
  /** The Scope this route document is keyed under. */
  scope: Scope;
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

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
