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
import { defineRouteState, routeBindingSchema } from "./route-state.ts";
import {
  cellReviewSchema,
  LOW_CONFIDENCE_REFINE_ERROR,
  lowConfidenceIsFlagged,
  trichotomyAgentMask,
} from "./trichotomy.ts";

/* ── Field trichotomy — settings keep the shared proposal/staged/review shape.
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
export const settingsProposalSourceSchema = z.object({
  blockId: z.string(),
  rowIdx: z.number().int().nonnegative().optional(),
  colIdx: z.number().int().nonnegative().optional(),
  note: z.string().nullish(),
});
export type SettingsProposalSource = z.infer<typeof settingsProposalSourceSchema>;

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
  review: cellReviewSchema.default("none"),
});
export type SettingsFieldState = z.infer<typeof settingsFieldStateSchema>;

/* ── Open-document snapshot (settings.document.open / refresh) ─────────────── */

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

export const settingsValidationSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(settingsValidationIssueSchema).default([]),
});
export type SettingsValidation = z.infer<typeof settingsValidationSchema>;

export const settingsSnapshotSchema = z.object({
  documentId: settingsDocumentIdSchema,
  /** Raw JSON text as stored on disk — the save target. */
  rawContent: z.string(),
  /** Composed content (directives resolved), display-only. */
  composedContent: z.string().nullish(),
  versionToken: z.string().nullish(),
  modifiedUtc: z.string().nullish(),
  validation: settingsValidationSchema.nullish(),
  takenAt: z.string().nullish(),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

export const settingsRouteDocumentSchema = z
  .object({
    binding: routeBindingSchema,
    snapshot: settingsSnapshotSchema.nullish(),
    /** field pointer -> trichotomy state. Keys are RFC 6901 JSON Pointers into the parsed raw JSON. */
    fields: z.record(z.string(), settingsFieldStateSchema).default({}),
    savedAt: z.string().nullish(),
  })
  .refine((document) => lowConfidenceIsFlagged(document.fields), {
    error: LOW_CONFIDENCE_REFINE_ERROR,
  });
export type SettingsRouteDocument = z.infer<typeof settingsRouteDocumentSchema>;

export const settingsRouteState = defineRouteState({
  route: "settings",
  title: "Settings",
  description: "Review, validate, and save proposed changes to a typed settings document.",
  key: "route:settings",
  schema: settingsRouteDocumentSchema,
  agentWriteMask: trichotomyAgentMask("fields"),
  commands: {
    create: {
      description:
        "Create a new settings document from raw JSON, then open the exact saved document into the shared snapshot. Fails if the path already exists.",
      input: z.object({
        documentId: settingsDocumentIdSchema,
        rawContent: z.string(),
      }),
      actor: "any",
      mutatesExternal: true,
    },
    open: {
      description:
        "Open a settings document (module/root/relative path) into the snapshot: raw + composed content, version token, and validation. Existing proposals are preserved.",
      input: z.object({ documentId: settingsDocumentIdSchema }),
      actor: "any",
      recoversExternal: true,
    },
    refresh: {
      description:
        "Re-read the currently open settings document (fresh raw content, version token, validation). Proposals and staged values are preserved.",
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
        "HUMAN ONLY. Splice every staged field into the raw content and save through settings.document.save with the captured version token. Successful saves fold into the snapshot and clear staged fields; conflicts and validation failures leave them staged.",
      input: z.object({}),
      actor: "human",
      mutatesExternal: true,
    },
  },
});

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

/** Encode property segments as an RFC 6901 JSON Pointer field key. */
export function settingsFieldPointer(segments: string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
}
