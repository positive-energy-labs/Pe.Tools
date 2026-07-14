/**
 * /settings document — collaborative state for schema-backed host settings authoring.
 *
 * Third instance of the proposal → staged → committed trichotomy (after family-types
 * cells and parameter-links draft/preview/apply). Fields are addressed by dot-joined
 * JSON paths into the settings document's parsed raw content (e.g. "revit.units.length").
 * Pea proposes field values; the human stages them; the human-only `save` command
 * splices staged values into the raw content and writes through `settings.document.save`
 * with the optimistic-concurrency version token captured at open/refresh.
 */
import { z } from "zod";
import { defineRouteState, routeBindingSchema } from "./route-state.ts";
import {
  LOW_CONFIDENCE_REFINE_ERROR,
  lowConfidenceIsFlagged,
  trichotomyAgentMask,
  trichotomyCellSchema,
} from "./trichotomy.ts";

/* ── Field trichotomy — the shared core with JSON values. The staged presence
   object (`{ value } | null`) replaces the old staged+hasStaged sidecar wart. ── */

export const settingsFieldStateSchema = trichotomyCellSchema(z.unknown());
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
    /** field path -> trichotomy state. Paths are dot-joined keys into the parsed raw JSON. */
    fields: z.record(z.string(), settingsFieldStateSchema).default({}),
    savedAt: z.string().nullish(),
  })
  .refine((document) => lowConfidenceIsFlagged(document.fields), {
    error: LOW_CONFIDENCE_REFINE_ERROR,
  });
export type SettingsRouteDocument = z.infer<typeof settingsRouteDocumentSchema>;

export const settingsRouteState = defineRouteState({
  route: "settings",
  key: "route:settings",
  schema: settingsRouteDocumentSchema,
  agentWriteMask: trichotomyAgentMask("fields"),
  commands: {
    open: {
      description:
        "Open a settings document (module/root/relative path) into the snapshot: raw + composed content, version token, and validation. Existing proposals are preserved.",
      input: z.object({ documentId: settingsDocumentIdSchema }),
      actor: "any",
    },
    refresh: {
      description:
        "Re-read the currently open settings document (fresh raw content, version token, validation). Proposals and staged values are preserved.",
      input: z.object({}),
      actor: "any",
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
    },
  },
});

/** Split a dot-joined settings field path into JSON segments. */
export function settingsFieldSegments(path: string): string[] {
  return path.split(".").filter((segment) => segment.length > 0);
}
