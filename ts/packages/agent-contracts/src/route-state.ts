/** Shared Work schemas and semantic commands. The host stamps authorship and checks revisions.
 * Authored edits and optional suggestions use one model for human and Pea. External effects
 * belong to ActionJournal; observations and readback use trusted host publication contracts.
 */
import { z } from "zod";
import { addressSchema, documentRefSchema, type Address } from "./target.ts";

export interface RouteStateSpec<TSchema extends z.ZodType> {
  /** Route name, e.g. `parameter-links` — the URL segment transport adapters key on. */
  route: string;
  /** Human-facing discovery metadata; adapters should not duplicate this. */
  title: string;
  description: string;
  /** Search words for this route's edit door. */
  finds?: readonly string[];
  schema: TSchema;
  editable?: readonly import("./command.ts").WorkPath[];
  /** Domain-derived bookkeeping after an authored edit, before validation. */
  reconcileEdit?: (next: unknown, patches: readonly RouteStatePatch[]) => unknown;
  /**
   * What a person may carry over from Work this schema can no longer read (before or after start
   * fresh), read tolerantly from the old document. Never throws, never parses into Work.
   */
  salvage?: (raw: unknown) => unknown;
}

/**
 * A registration's check on a write the schema already admitted, run before it lands, for
 * truth only the host can read (Families: the family types a cell key names). Null admits.
 */
export type RouteWriteAdmission = (
  doc: unknown,
  patches: readonly RouteStatePatch[],
  ctx: { scope: WorkKey; by: import("./route-doc.ts").WorkAuthor; prior: unknown },
) => Promise<import("./families.ts").FamiliesRefusal | null>;

/** Work has one binding. `from` is the Save As source, never its identity. */
const workFields = {
  route: z.string().min(1).max(100),
  target: z.null(),
  work: z.never().optional(),
  open: z.never().optional(),
};
export const workKeySchema = z.discriminatedUnion("binding", [
  z.object({
    ...workFields,
    binding: z.literal("address"),
    target: addressSchema,
    from: documentRefSchema.optional(),
  }),
  z.object({ ...workFields, binding: z.literal("open"), open: documentRefSchema }),
  z.object({
    ...workFields,
    binding: z.literal("workspace"),
    work: z.string().trim().min(1).max(200),
  }),
  z.object({ ...workFields, binding: z.literal("host") }),
]);
export type WorkKey = z.infer<typeof workKeySchema>;

/** Construct a binding from the caller's resolved document or explicit workspace. */
export function bindWork(
  route: string,
  target: Address | null,
  work?: string,
  open?: z.infer<typeof documentRefSchema>,
): WorkKey {
  if (work !== undefined) return { binding: "workspace", route, target: null, work };
  if (target !== null)
    return { binding: "address", route, target, ...(open ? { from: open } : {}) };
  if (open) return { binding: "open", route, target: null, open };
  return { binding: "host", route, target: null };
}

/** The one encoder for the persisted identity. */
export function workKey(key: WorkKey): string {
  switch (key.binding) {
    case "workspace":
      return `${key.route}/workspace:${key.work}`;
    case "open":
      return `${key.route}/open:${key.open.session}/${key.open.openId}`;
    case "address":
      return `${key.route}/target:${key.target.replaceAll("/", "\\").toLowerCase()}`;
    case "host":
      return `${key.route}/target:`;
  }
}

/** The document type a spec's schema parses to. */
export type RouteDocOf<TSpec> =
  TSpec extends RouteStateSpec<infer TSchema> ? z.infer<TSchema> : never;

/** A segment-array patch. Omit `value` to delete. Host-issued restore may replace the root at []. */
export const routeStatePatchSchema = z.object({
  path: z.array(z.union([z.string(), z.number()]), {
    error: 'must be a segment array, e.g. ["scope","suggestion"]',
  }),
  value: z.unknown().optional(),
});
export type RouteStatePatch = z.infer<typeof routeStatePatchSchema>;

/** One invocation, never one identity per patch. Authorship comes from the host principal. */
export const workWriteSchema = z.object({
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int().nonnegative(),
  press: z.string().min(1).nullable(),
  kind: z.enum(["apply", "restore"]).default("apply"),
});
export type WorkWrite = z.infer<typeof workWriteSchema>;
export type WorkWriteAck = {
  key: WorkKey;
  kind: "apply" | "restore" | "publish" | "start-fresh";
  by: import("./route-doc.ts").WorkAuthor;
  press: string | null;
  base: number;
  revision: number;
  /** The accepted delta, including stamps, parent creation and reconciliation. */
  patches: RouteStatePatch[];
  inverse: RouteStatePatch[];
  undoable: boolean;
  /** Recovery keeps the unparsed envelope at this host-owned location. */
  aside?: string;
};

/** The wire form of an accepted write: what the host stamped, validated where a browser receives it. */
export const workWriteAckSchema: z.ZodType<WorkWriteAck> = z.object({
  key: workKeySchema,
  kind: z.enum(["apply", "restore", "publish", "start-fresh"]),
  by: z.enum(["pea", "human"]),
  press: z.string().min(1).nullable(),
  base: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  patches: z.array(routeStatePatchSchema),
  inverse: z.array(routeStatePatchSchema),
  undoable: z.boolean(),
  aside: z.string().optional(),
});

export type RouteWriteKind = "error" | "refused" | "advisory" | "partial";

export type RouteStateWriteResult =
  | { ok: true; revision: number; doc?: unknown; result?: unknown; write: WorkWriteAck }
  | {
      ok: false;
      kind: RouteWriteKind;
      error: string;
      hint: string;
      code?: import("./route-doc.ts").RouteRefusalCode;
      revision?: number;
    }
  | (import("./families.ts").FamiliesRefusal & { revision?: number });

/** A refused write's prose: the route's error, or the Families door's `agentHint`. */
export const refusalText = (refused: Extract<RouteStateWriteResult, { ok: false }>): string =>
  "agentHint" in refused ? refused.agentHint : refused.error;

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

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
