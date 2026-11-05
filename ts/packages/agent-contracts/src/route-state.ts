import type { GraphJsonValue as JsonValue } from "./route-graph.ts";
/** Shared Work schemas and semantic commands. The host stamps authorship and checks revisions.
 * Authored edits and optional suggestions use one model for human and Pea. External effects
 * belong to ActionJournal; observations and readback use trusted host publication contracts.
 */
import { z } from "zod";
import {
  addressSchema,
  documentRefSchema,
  sameAddress,
  type Address,
  type DocumentRef,
} from "./target.ts";

export interface RouteStateSpec<TSchema extends z.ZodType> {
  /** Route name, e.g. `parameter-links` — the URL segment transport adapters key on. */
  route: string;
  /** Human-facing discovery metadata; adapters should not duplicate this. */
  title: string;
  description: string;
  /** Search words for this route's edit door. */
  finds?: readonly string[];
  schema: TSchema;
  /** Monotonic authored-Work schema age, independent of the transport envelope version. */
  schemaVersion?: number;
  /** Each key upgrades exactly that saved schema age to the next. */
  migrations?: Readonly<Record<number, (doc: unknown) => unknown>>;
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

/** Each closed binding owns admission; adapters supply current identity, never provenance. */
export function workBinding(key: WorkKey) {
  return {
    admits(target: DocumentRef, address: string | null | undefined, workspace = false): boolean {
      switch (key.binding) {
        case "open":
          return key.open.session === target.session && key.open.openId === target.openId;
        case "address":
          return !!address && sameAddress(key.target, address as Address);
        case "workspace":
          return workspace;
        case "host":
          return false;
      }
    },
  };
}

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

/**
 * ADR 0030 rule 9: the one stored identity however a caller spelled it. GUID and Windows path case and
 * separators fold, as `sameAddress` compares them. Save As `from` is transport, not identity: it rides
 * until the first read carries the open-document Work onto the Address (RouteWorkspace #carryOver).
 */
export function canonicalWorkKey(key: WorkKey): WorkKey {
  if (key.binding !== "address") return key;
  return { ...key, target: key.target.replaceAll("/", "\\").toLowerCase() as Address };
}

/** The one encoder for the persisted identity; `from` never enters it. */
export function workKey(key: WorkKey): string {
  const canonical = canonicalWorkKey(key);
  switch (canonical.binding) {
    case "workspace":
      return `${canonical.route}/workspace:${canonical.work}`;
    case "open":
      return `${canonical.route}/open:${canonical.open.session}/${canonical.open.openId}`;
    case "address":
      return `${canonical.route}/target:${canonical.target}`;
    case "host":
      return `${canonical.route}/target:`;
  }
}

/** The document type a spec's schema parses to. */
export type RouteDocOf<TSpec> =
  TSpec extends RouteStateSpec<infer TSchema> ? z.infer<TSchema> : never;

/** A segment-array patch. Omit `value` to delete. Host-issued restore may replace the root at []. */
export const routeStatePatchSchema = z.object({
  path: z.array(z.union([z.string(), z.number()]), {
    error: 'must be a segment array, e.g. ["scope","edit"]',
  }),
  value: z.unknown().optional(),
});
export type RouteStatePatch = z.infer<typeof routeStatePatchSchema>;

const historyMetaSchema: z.ZodType<JsonValue> = z.json();
/** The host write door's history-detail refusals; every reader names them from here. */
export const historyMetaRefusalCodes = ["invalid_meta", "meta_too_large"] as const;
export type HistoryMetaRefusalCode = (typeof historyMetaRefusalCodes)[number];
export const isHistoryMetaRefusalCode = (code: unknown): code is HistoryMetaRefusalCode =>
  (historyMetaRefusalCodes as readonly unknown[]).includes(code);
/** Serialized history detail ceiling at the host write door. */
export const HISTORY_META_MAX_BYTES = 4096;

/** One invocation, never one identity per patch. Authorship comes from the host principal. */
export const workWriteSchema = z.object({
  causalParent: z.string().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  /** Route presentation; never inverse, authorship, or authority. */
  meta: historyMetaSchema.optional(),
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int().nonnegative(),
  press: z.string().min(1).nullable(),
  kind: z.enum(["apply", "restore"]).default("apply"),
  restoreOf: z.number().int().positive().optional(),
});
export type WorkWrite = z.infer<typeof workWriteSchema>;
export type WorkWriteAck = {
  key: WorkKey;
  kind: "apply" | "restore" | "publish" | "start-fresh";
  by: import("./route-doc.ts").WorkAuthor;
  press: string | null;
  /** Host-issued step identity and exact transition restored, never inferred from patch equality. */
  step?: string;
  label?: string;
  /** Route presentation; never inverse, authorship, or authority. */
  meta?: JsonValue;
  /** Host verdict at load: stored `meta` no longer decodes under the admitted schema. */
  detail?: "unavailable";
  restoreOf?: number;
  /** Receipt whose confirmed outcome retired these cells. */
  receiptId?: string;
  base: number;
  revision: number;
  /** The accepted delta, including stamps, parent creation and reconciliation. */
  patches: RouteStatePatch[];
  inverse: RouteStatePatch[];
  undoable: boolean;
  /** When the host accepted it (ms); a reloaded tab's History reads this, not its own clock. */
  at?: number;
  /** Sent from the host's retained window when a reader subscribed: history it inherits, not a live edit. */
  replay?: true;
  /** Recovery keeps the unparsed envelope at this host-owned location. */
  aside?: string;
};

/** The wire form of an accepted write: what the host stamped, validated where a browser receives it. */
export const workWriteAckSchema: z.ZodType<WorkWriteAck> = z.object({
  key: workKeySchema,
  kind: z.enum(["apply", "restore", "publish", "start-fresh"]),
  by: z.enum(["pea", "human"]),
  press: z.string().min(1).nullable(),
  step: z.string().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  /** Route presentation; never inverse, authorship, or authority. */
  meta: historyMetaSchema.optional(),
  detail: z.literal("unavailable").optional(),
  receiptId: z.string().min(1).optional(),
  restoreOf: z.number().int().positive().optional(),
  base: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  patches: z.array(routeStatePatchSchema),
  inverse: z.array(routeStatePatchSchema),
  undoable: z.boolean(),
  at: z.number().optional(),
  replay: z.literal(true).optional(),
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
  | {
      ok: false;
      kind: "refused";
      code: HistoryMetaRefusalCode;
      error: string;
      hint: string;
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

/**
 * Saved Work this version's schema refuses, read as far as it still parses: every segment (and
 * every keyed cell of a record segment) that parses is kept, only the broken ones are dropped and
 * named in `dropped` (`segment` or `segment.key`). No migration of old shapes: a dropped cell is
 * just gone from this read. A document-level refusal (a cross-cell rule) drops the segments it
 * names. `whole` is true when nothing at all was readable.
 */
export function salvageWork<S extends z.ZodObject>(
  schema: S,
  raw: unknown,
): { doc: z.infer<S>; dropped: string[]; whole: boolean } {
  const whole = schema.safeParse(raw);
  if (whole.success) return { doc: whole.data, dropped: [], whole: false };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { doc: schema.parse({}), dropped: ["(whole document)"], whole: true };
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [segment, value] of Object.entries(raw)) {
    const shape = (schema.shape as Record<string, z.ZodType | undefined>)[segment];
    if (!shape) {
      dropped.push(segment);
      continue;
    }
    if (shape.safeParse(value).success) {
      kept[segment] = value;
      continue;
    }
    const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
    const cells = isRecord ? Object.entries(value) : [];
    const keptCells = cells.filter(([key, cell]) => {
      const ok = shape.safeParse({ [key]: cell }).success;
      if (!ok) dropped.push(`${segment}.${key}`);
      return ok;
    });
    if (!cells.length) dropped.push(segment);
    else if (keptCells.length) kept[segment] = Object.fromEntries(keptCells);
  }
  const second = schema.safeParse(kept);
  if (second.success) return { doc: second.data, dropped: [...new Set(dropped)], whole: false };
  // A cross-cell rule broke the kept cells: drop the segments its issues name, whole.
  const broken = new Set(second.error.issues.map((issue) => String(issue.path[0])));
  return {
    doc: schema.parse(Object.fromEntries(Object.entries(kept).filter(([k]) => !broken.has(k)))),
    dropped: [...new Set([...dropped, ...broken])],
    whole: false,
  };
}
