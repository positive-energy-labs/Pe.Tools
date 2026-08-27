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
import { addressSchema, type Address } from "./reading.ts";

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

/** The document type a spec's schema parses to. */
export type RouteDocOf<TSpec> =
  TSpec extends RouteStateSpec<infer TSchema> ? z.infer<TSchema> : never;

/** A single segment-array patch. Omit `value` to delete the key. */
export interface RouteStatePatch {
  path: (string | number)[];
  value?: unknown;
}

export interface RouteStateWriteResult {
  ok: boolean;
  code?: import("./route-doc.ts").RouteRefusalCode;
  revision?: number;
  error?: string;
  hint?: string;
  doc?: unknown;
  result?: unknown;
}

/* ── Session binding (substrate-owned doc segment) ─────────────────────────── */

/**
 * A route document's named external bindings. Each records the document Address
 * where it was picked; `current` rejects a binding from any other document.
 */
export const bindSchema = z.object({
  id: z.string(),
  label: z.string(),
  at: addressSchema,
});
export type Bind = z.infer<typeof bindSchema>;
export const routeBindingsSchema = z.record(z.string(), bindSchema).default({});

/** A binding is meaningful only against the document where it was picked. */
export const current = (bind: Bind | null | undefined, at: Address): Bind | null =>
  bind?.at === at ? bind : null;

/** Return a command's explicit world target, when present. */
export function resolveTarget(input: unknown): string | undefined {
  const explicit = (input as { target?: unknown } | null | undefined)?.target;
  return typeof explicit === "string" && explicit.length > 0 ? explicit : undefined;
}

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
  /** The Revit document this route document belongs to. */
  documentAddress: Address;
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
