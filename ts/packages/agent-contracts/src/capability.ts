import { discoveryMachine, type DiscoveryMachine } from "./discovery-machine.ts";
/**
 * Capability — the ONE row type every pea door reads. Ops, route documents, route commands,
 * pod buttons, and skills project into this shape; `pe_find` ranks it, `pe_read` runs the
 * non-mutating rows, `pe_do` runs any row. There are no visibility tiers: ranking and the
 * `needs` filter replace hiding.
 */
import { z } from "zod";
import {
  capabilityProjectionSchema,
  contributionKindSchema,
  contributionSourcePath,
  contributionSourceSchema,
  isCanonicalSlug,
  parseContributionKey,
} from "./contribution.ts";
import type { Machine } from "./machine.ts";
import { principalSchema, type Principal } from "./principal.ts";

/** Native/Work metadata projects to actual callers; service contexts never operate the product. */
export function capabilityPrincipals(
  mutates: boolean,
  actor: "any" | "human" | "agent" = "any",
): Principal[] {
  if (actor === "human") return ["human"];
  const permitted: Principal[] = actor === "agent" ? ["pea", "page"] : ["human", "pea", "page"];
  return mutates ? permitted : [...permitted, "external-mcp"];
}

export const capabilityKindSchema = z.enum([
  "op",
  "route-doc",
  "route-command",
  ...contributionKindSchema.options,
  "document",
  "recent",
]);
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
    /** Compiled keys retain their grammar; packaged keys use the contribution codec. */
    key: z.string().min(1),
    kind: capabilityKindSchema,
    title: z.string(),
    /** Search words, ranked like capability keys. */
    finds: z.array(z.string()).optional(),
    /** Routing text — the only place capability prose lives. */
    description: z.string(),
    needs: capabilityNeedsSchema,
    effect: z.enum(["query", "command"]),
    /** Search projection; effect is the execution classification. */
    mutates: z.boolean(),
    principal: z.array(principalSchema).min(1),
    /** JSON Schema of the row's input. */
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()).optional(),
    /** Who generated this row: catalog, route registry, pod.json, skills. */
    source: z.string(),
    package: contributionSourceSchema.optional(),
    projection: capabilityProjectionSchema.optional(),
    /** Ranking nudge: the op catalog's DefaultVisible tier ranks first; nothing is hidden. */
    rank: z.number().default(0),
  })
  .strict()
  .superRefine((row, ctx) => {
    const packaged = contributionKindSchema.safeParse(row.kind).success;
    const reference = parseContributionKey(row.key);
    if (
      packaged &&
      (!reference ||
        reference.kind !== row.kind ||
        !row.package ||
        row.package.id !== reference.packageId ||
        row.package.path !== contributionSourcePath(reference))
    )
      ctx.addIssue({
        code: "custom",
        message: "Packaged capability must name its canonical key and admitted entry bytes",
      });
    if (!packaged && (reference || row.package || row.projection))
      ctx.addIssue({
        code: "custom",
        message: "Compiled capability cannot assert package identity",
      });
    if (row.kind === "member" && (row.mutates || row.needs !== "nothing"))
      ctx.addIssue({ code: "custom", message: "Members are read/mention-only" });
  });
export type Capability = z.infer<typeof capabilitySchema>;

/** One entry of Revit's per-year recent documents, as `pe-revit doc list --recent` reads it. */
export const capabilityRecentSchema = z.object({
  title: z.string(),
  /** A local path, or the `cld://<region>/{project}<name>/{model}<name>.rvt` a cloud model opens by. */
  path: z.string(),
  isCloud: z.boolean(),
  region: z.string().nullable(),
  projectGuid: z.string().nullable(),
  modelGuid: z.string().nullable(),
  /** The Revit year whose recent list holds it. */
  year: z.number(),
  /** The year the file was saved in; null for a cloud model or an unreadable file. */
  savedYear: z.number().nullable(),
  /** 1 is that year's most recent. */
  rank: z.number(),
});
export type CapabilityRecent = z.infer<typeof capabilityRecentSchema>;

/** What `GET /pe/capabilities` serves: rows plus the orientation `pe_find` folds in. */
export const capabilityCatalogSchema = z.object({
  at: z.string(),
  /** The bridge session the op rows were read from, when one answered. */
  bridgeSessionId: z.string().optional(),
  machine: z
    .custom<Machine | DiscoveryMachine>(
      (value) =>
        !!value &&
        typeof value === "object" &&
        "revit" in value &&
        "legs" in value &&
        "observedAtUtc" in value,
    )
    .transform(discoveryMachine),
  /** Revit's recent documents (no Revit needed); absent when the catalog was built without them. */
  recents: z.array(capabilityRecentSchema).optional(),
  /** Per-source outcome; a source that could not answer says why instead of hiding rows. */
  sources: z.record(z.string(), z.string()),
  /** Warnings about scratch Page folders; a noncanonical one still works when its name is safe. */
  diagnostics: z.array(
    z.discriminatedUnion("code", [
      z.strictObject({
        code: z.literal("page.noncanonical-folder"),
        folder: z.string().min(1),
        canonicalSlug: z.string().refine(isCanonicalSlug, "Expected a canonical scratch Page slug"),
        message: z.string().min(1),
      }),
      /** Folders that differ only by case: none of them is a Page until one is renamed. */
      z.strictObject({
        code: z.literal("page.folder-collision"),
        folders: z.array(z.string().min(1)).min(2),
        message: z.string().min(1),
      }),
    ]),
  ),
  capabilities: z.array(capabilitySchema),
});
export type CapabilityCatalog = z.infer<typeof capabilityCatalogSchema>;

/** `route:families.propose` → `{ route: "families", member: "propose" }`; `route:families` → member undefined. */
export function parseRouteKey(key: string): { route: string; member?: string } | null {
  if (!key.startsWith("route:")) return null;
  const rest = key.slice("route:".length);
  const dot = rest.indexOf(".");
  return dot === -1 ? { route: rest } : { route: rest.slice(0, dot), member: rest.slice(dot + 1) };
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
      (query.needs === undefined ||
        row.needs === query.needs ||
        (query.needs === "document" &&
          (row.needs === "project-document" || row.needs === "family-document"))) &&
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
  const finds = row.finds?.map((find) => find.toLowerCase()) ?? [];
  const title = row.title.toLowerCase();
  const description = row.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (key.includes(term)) score += 4;
    if (finds.some((find) => find.includes(term))) score += 4;
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
