/**
 * Route state — the declarative contract for a collaborative route workspace.
 *
 * A route that wants pea + human co-editing declares a zod document schema,
 * a declarative agent write mask (which paths pea may propose to — everything else is human-only),
 * and named commands that read or change that Work document. External effects use semantic actions
 * and ActionJournal instead. No per-route server code beyond the schema, mask, and Work command
 * handlers: RouteWorkspace (packages/runtime) owns document persistence, ordering, validation, and commands; the
 * pea doors (`pe_read route:<name>`, `pe_do route:<name>.propose|<command>`) are thin
 * HTTP clients to its endpoints; the browser writes the same scoped document as `actor:"human"`
 * (unmasked) and receives document snapshots through its route-specific event stream.
 */
import { z } from "zod";
import { addressSchema, type Address } from "./target.ts";

/** A named Work command a route exposes. `actor:"human"` commands reject pea. */
export interface RouteStateCommandSpec {
  description: string;
  input: z.ZodType;
  actor: "any" | "human";
}

export interface RouteStateSpec<TSchema extends z.ZodType> {
  /** Route name, e.g. `parameter-links` — the URL segment transport adapters key on. */
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
  /**
   * What a person may carry over from Work this schema can no longer read (before or after start
   * fresh), read tolerantly from the old document. Never throws, never parses into Work.
   */
  salvage?: (raw: unknown) => unknown;
}

/**
 * A registration's check on a write the schema and mask already admitted, run before it lands, for
 * truth only the host can read (Families: the family types a cell key names). Null admits.
 */
export type RouteWriteAdmission = (
  doc: unknown,
  patches: readonly RouteStatePatch[],
  ctx: { scope: WorkKey; actor: import("./route-doc.ts").RouteActor; prior: unknown },
) => Promise<import("./route-doc.ts").RouteRefusal | null>;

/**
 * The identity a Work document lives under: its route, the Address it is bound to, and an
 * optional named standalone workspace (`?work=<id>`) for Work that is not document-scoped.
 *
 * Work outlives a Revit process (section 2, law 6), so it keys by Address, never by an
 * `open` request's openId. A caller holding a `DocumentRequest` resolves it to an Address
 * through the inventory before it names Work.
 */
export const workKeySchema = z.object({
  route: z.string().min(1).max(100),
  target: addressSchema.nullable(),
  work: z.string().trim().min(1).max(200).optional(),
});
export type WorkKey = z.infer<typeof workKeySchema>;

/** The one key function: the persisted key a Work document lives under. */
export const workKey = (key: WorkKey): string =>
  key.work !== undefined
    ? `${key.route}/workspace:${key.work}`
    : `${key.route}/target:${key.target === null ? "" : key.target.replaceAll("/", "\\").toLowerCase()}`;

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
 * never a binding: it is part of the Target the document is keyed under. */
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
  /** The Address this route document is keyed under. */
  target: Address | null;
  /** The named standalone workspace when this Work is not document-scoped. */
  work?: string;
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
