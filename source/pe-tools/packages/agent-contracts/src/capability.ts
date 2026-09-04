/**
 * Capability — the ONE row type every pea door reads. Ops, route documents, route commands,
 * pod buttons, and skills project into this shape; `pe_find` ranks it, `pe_read` runs the
 * non-mutating rows, `pe_do` runs any row. There are no visibility tiers: ranking and the
 * `needs` filter replace hiding.
 */
import { z } from "zod";

export const capabilityKindSchema = z.enum(["op", "route-doc", "route-command", "pod", "skill"]);
export type CapabilityKind = z.infer<typeof capabilityKindSchema>;

export const capabilityNeedsSchema = z.enum([
  "nothing",
  "document",
  "project-document",
  "family-document",
  "session",
]);
export type CapabilityNeeds = z.infer<typeof capabilityNeedsSchema>;

export const capabilitySchema = z
  .object({
    /** `op:revit.catalog.loaded-families`, `route:instances.start`, `pod:sheets.rename`, `skill:build-pod` */
    key: z.string().min(1),
    kind: capabilityKindSchema,
    title: z.string(),
    /** Routing text — the only place capability prose lives. */
    description: z.string(),
    needs: capabilityNeedsSchema,
    mutates: z.boolean(),
    actor: z.enum(["any", "human"]),
    /** JSON Schema of the row's input. */
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()).optional(),
    /** Who generated this row: catalog, route registry, pod.json, skills. */
    source: z.string(),
    /** Ranking nudge: the op catalog's DefaultVisible tier ranks first; nothing is hidden. */
    rank: z.number().default(0),
  })
  .strict();
export type Capability = z.infer<typeof capabilitySchema>;

export const capabilitySessionSchema = z.object({
  sessionId: z.string().optional(),
  custody: z.string().optional(),
  sdkSessionId: z.string().nullable().optional(),
  revitVersion: z.string().nullable().optional(),
  activeDocumentTitle: z.string().nullable().optional(),
  activeDocument: z.string().nullable().optional(),
});

/** What `GET /pe/capabilities` serves: rows plus the orientation `pe_find` folds in. */
export const capabilityCatalogSchema = z.object({
  at: z.string(),
  /** The bridge session the op rows were read from, when one answered. */
  bridgeSessionId: z.string().optional(),
  sessions: z.array(capabilitySessionSchema),
  /** Per-source outcome; a source that could not answer says why instead of hiding rows. */
  sources: z.record(z.string(), z.string()),
  capabilities: z.array(capabilitySchema),
});
export type CapabilityCatalog = z.infer<typeof capabilityCatalogSchema>;

/** `route:instances.start` → `{ route: "instances", member: "start" }`; `route:instances` → member undefined. */
export function parseRouteKey(key: string): { route: string; member?: string } | null {
  if (!key.startsWith("route:")) return null;
  const rest = key.slice("route:".length);
  const dot = rest.indexOf(".");
  return dot === -1 ? { route: rest } : { route: rest.slice(0, dot), member: rest.slice(dot + 1) };
}

/** `pod:<workspace>.<entrypoint>` → the two halves; entrypoint ids never contain a dot. */
export function parsePodKey(key: string): { workspace: string; entrypoint: string } | null {
  if (!key.startsWith("pod:")) return null;
  const rest = key.slice("pod:".length);
  const dot = rest.lastIndexOf(".");
  return dot === -1 ? null : { workspace: rest.slice(0, dot), entrypoint: rest.slice(dot + 1) };
}

export interface CapabilityQuery {
  query?: string;
  kind?: CapabilityKind;
  needs?: CapabilityNeeds;
  mutates?: boolean;
  limit?: number;
}

/** Rank rows for a query. Pure and deterministic; ties break on rank, then key. */
export function findCapabilities(
  rows: readonly Capability[],
  query: CapabilityQuery,
): Capability[] {
  const terms = (query.query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
  const filtered = rows.filter(
    (row) =>
      (query.kind === undefined || row.kind === query.kind) &&
      (query.needs === undefined || row.needs === query.needs) &&
      (query.mutates === undefined || row.mutates === query.mutates),
  );
  const scored = filtered
    .map((row) => ({ row, score: scoreCapability(row, terms) }))
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.row.rank - a.row.rank || a.row.key.localeCompare(b.row.key),
    );
  return scored.slice(0, query.limit ?? 8).map((entry) => entry.row);
}

function scoreCapability(row: Capability, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const key = row.key.toLowerCase();
  const title = row.title.toLowerCase();
  const description = row.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (key.includes(term)) score += 4;
    if (title.includes(term)) score += 3;
    if (description.includes(term)) score += 1;
  }
  return score;
}

/** The compressed map: counts per kind and a few rows per kind. Map before territory. */
export function capabilityMap(rows: readonly Capability[], perKind = 4) {
  const kinds = capabilityKindSchema.options.map((kind) => {
    const of = rows.filter((row) => row.kind === kind).sort((a, b) => b.rank - a.rank);
    return {
      kind,
      count: of.length,
      mutating: of.filter((row) => row.mutates).length,
      top: of.slice(0, perKind).map((row) => ({ key: row.key, title: row.title })),
    };
  });
  return { total: rows.length, kinds: kinds.filter((entry) => entry.count > 0) };
}
