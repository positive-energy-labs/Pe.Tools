/**
 * /settings document — collaborative state for schema-backed host settings authoring.
 *
 * Third instance of the proposal → staged → committed trichotomy (after family-types
 * cells and parameter-links draft/preview/apply). Fields are addressed by RFC 6901
 * JSON Pointers into the settings document's parsed raw content (e.g.
 * "/revit/units/length") — pointer escaping means property names may contain periods
 * and slashes (spec-sheet values like "M.2 Depth" address cleanly).
 * Pea proposes field values; the human stages them; the human-only `save` command
 * splices staged values into the raw content and writes through `settings.document.save`
 * with the optimistic-concurrency version token captured at open/refresh.
 */
import { z } from "zod";
import { routeBindingsSchema, type RouteStateSpec } from "./route-state.ts";
import { trichotomyAgentMask } from "./trichotomy.ts";

/* ── Field trichotomy — settings keep the shared proposal/staged shape.
   A staged `{ value }` assigns JSON; `{ delete: true }` removes the property. ── */

const settingsFieldEditSchema = z
  .object({
    value: z.unknown().optional(),
    delete: z.literal(true).optional(),
  })
  .refine((edit) => edit.delete === true || Object.hasOwn(edit, "value"), {
    error: "a settings edit must set a value or delete the property",
  })
  .refine((edit) => !(edit.delete === true && Object.hasOwn(edit, "value")), {
    error: "a settings edit cannot both set and delete the property",
  });

/** One document citation for a proposed value, in markdown coordinates — pea never
 * sees a bbox. `blockId` may reference a parsed block OR a parser-extracted image;
 * the UI resolves geometry (measured/estimated) and refuses to draw what it can't. */
const settingsProposalSourceSchema = z.object({
  blockId: z.string(),
  rowIdx: z.number().int().nonnegative().optional(),
  colIdx: z.number().int().nonnegative().optional(),
  note: z.string().nullish(),
});
export const settingsFieldStateSchema = z.object({
  proposal: settingsFieldEditSchema
    .extend({
      by: z.enum(["pea", "human"]).default("pea"),
      note: z.string().nullish(),
      confidence: z.enum(["high", "low"]).nullish(),
      /** Multi-citation: one value may be grounded by several regions (a table
       * cell AND a figure). Order is presentation order. */
      sources: z.array(settingsProposalSourceSchema).nullish(),
    })
    .nullish(),
  staged: settingsFieldEditSchema.nullish(),
});
export type SettingsFieldState = z.infer<typeof settingsFieldStateSchema>;

/* ── Ephemeral file read (settings.document.open / refresh) ───────────────── */

export const settingsDocumentIdSchema = z.object({
  moduleKey: z.string(),
  rootKey: z.string(),
  relativePath: z.string(),
});
export type SettingsDocumentId = z.infer<typeof settingsDocumentIdSchema>;

export const settingsValidationIssueSchema = z.looseObject({
  message: z.string(),
  severity: z.string().nullish(),
  path: z.string().nullish(),
});

const settingsValidationSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(settingsValidationIssueSchema).default([]),
});
export type SettingsValidation = z.infer<typeof settingsValidationSchema>;

export const settingsSnapshotSchema = z.object({
  documentId: settingsDocumentIdSchema,
  path: z.string(),
  versionToken: z.string().nullable(),
  observedAt: z.iso.datetime(),
  /** Raw JSON text as stored on disk — the save target. */
  rawContent: z.string(),
  /** Composed content (directives resolved), display-only. */
  composedContent: z.string().nullish(),
  dependencies: z
    .array(z.object({ directivePath: z.string(), documentId: settingsDocumentIdSchema }))
    .optional(),
  modifiedUtc: z.string().nullish(),
  validation: settingsValidationSchema.nullish(),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

const settingsRouteDocumentSchema = z.object({
  bindings: routeBindingsSchema,
  documentId: settingsDocumentIdSchema.nullable().default(null),
  /** field pointer -> trichotomy state. Keys are RFC 6901 JSON Pointers into the parsed raw JSON. */
  fields: z.record(z.string(), settingsFieldStateSchema).default({}),
  savedAt: z.string().nullish(),
});
export type SettingsRouteDocument = z.infer<typeof settingsRouteDocumentSchema>;

export const settingsRouteState = {
  route: "settings",
  title: "Settings",
  description: "Review, validate, and save proposed changes to a typed settings document.",
  schema: settingsRouteDocumentSchema,
  agentWriteMask: trichotomyAgentMask("fields"),
  commands: {
    create: {
      description:
        "Create a new settings document from raw JSON, then bind the exact saved document. Fails if the path already exists.",
      input: z.object({
        documentId: settingsDocumentIdSchema,
        rawContent: z.string(),
      }),
      actor: "any",
      mutatesExternal: true,
    },
    open: {
      description:
        "Bind a settings document (module/root/relative path). Readers fetch the file on bind; existing proposals are preserved.",
      input: z.object({ documentId: settingsDocumentIdSchema }),
      actor: "any",
      recoversExternal: true,
    },
    refresh: {
      description:
        "Re-read the bound settings document. Proposals and staged values are preserved.",
      input: z.object({}),
      actor: "any",
      recoversExternal: true,
    },
    validate: {
      description:
        "Validate the document with staged values spliced in (and proposals too when includeProposals is true) without saving. Use this to prove a proposal is schema-valid before the human stages it.",
      input: z.object({ includeProposals: z.boolean().optional() }),
      actor: "any",
    },
    save: {
      description:
        "HUMAN ONLY. Refetch the file, splice every staged field into its raw content, and save through settings.document.save with that version token. Successful saves clear staged fields; conflicts and validation failures leave them staged.",
      input: z.object({}),
      actor: "human",
      mutatesExternal: true,
    },
  },
} satisfies RouteStateSpec<typeof settingsRouteDocumentSchema>;

/** Decode an RFC 6901 JSON Pointer field key into property segments. */
export function settingsFieldSegments(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new Error(
      `Settings field keys are JSON Pointers and must start with "/" — got "${pointer}".`,
    );
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Locate a raw directive boundary without expanding or choosing a fragment's winning fields. */
export function settingsFieldDirectives(root: unknown, segments: string[]): string[] | null {
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    if (cursor == null || typeof cursor !== "object") return null;
    const object = cursor as Record<string, unknown>;
    if (
      ("$preset" in object || "$include" in object) &&
      !(index === segments.length - 1 && segment.startsWith("$"))
    ) {
      const directive = object.$preset ?? object.$include;
      return (Array.isArray(directive) ? directive : [directive]).filter(
        (value): value is string => typeof value === "string",
      );
    }
    cursor = object[segment];
  }
  return null;
}

/** Encode property segments as an RFC 6901 JSON Pointer field key. */
export function settingsFieldPointer(segments: string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
}
