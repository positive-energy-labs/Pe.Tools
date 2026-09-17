/**
 * /pods document — collaborative state for editing one pod member, addressed `{ pod, path }`.
 *
 * Third instance of the proposal → staged → committed trichotomy (after parameter-links
 * cells and parameter-links draft/preview/apply). Fields are addressed by RFC 6901
 * JSON Pointers into the member's parsed raw content (e.g.
 * "/revit/units/length") — pointer escaping means property names may contain periods
 * and slashes (spec-sheet values like "M.2 Depth" address cleanly).
 * Pea proposes field values; the human stages them; the human-only `settings.write` action
 * splices staged values into the raw content and writes through the host member writer
 * with the member SHA-256 explicitly adopted as its edit basis.
 */
import { z } from "zod";
import { type RouteStateSpec } from "./route-state.ts";
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

/* ── Ephemeral member read (pod.member.read / pod.member.compose) ────────── */

/** A pod member: the installed pod's manifest id plus its relative path. */
export const podMemberSchema = z.object({
  pod: z.string().min(1),
  path: z.string().min(1),
});
export type PodMember = z.infer<typeof podMemberSchema>;

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
  member: podMemberSchema,
  /** The member's SHA-256 when read; the conditional-write basis. */
  versionToken: z.string().nullable(),
  observedAt: z.iso.datetime().optional(),
  /** Raw JSON text as stored on disk — the save target. */
  rawContent: z.string(),
  /** Composed content (directives resolved), display-only. */
  composedContent: z.string().nullish(),
  dependencies: z
    .array(z.object({ id: z.string(), path: z.string(), sha256: z.string() }))
    .optional(),
  validation: settingsValidationSchema.nullish(),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

export const settingsBasisSchema = settingsSnapshotSchema
  .pick({
    member: true,
    rawContent: true,
  })
  .extend({ versionToken: z.string() });
export type SettingsBasis = z.infer<typeof settingsBasisSchema>;
const settingsRouteDocumentSchema = z.object({
  basis: settingsBasisSchema.nullable().default(null),
  fields: z.record(z.string(), settingsFieldStateSchema).default({}),
});
export type SettingsRouteDocument = z.infer<typeof settingsRouteDocumentSchema>;

export const settingsRouteState = {
  route: "pods",
  title: "Pods",
  description: "Review, validate, and save proposed changes to one pod member.",
  schema: settingsRouteDocumentSchema,
  agentWriteMask: trichotomyAgentMask("fields"),
  commands: {
    open: {
      description:
        "Explicitly adopt a file reading as the edit basis. Refuses pending edits; use adopt after reviewing a conflict.",
      input: z.object({ member: podMemberSchema }),
      actor: "any",
    },
    adopt: {
      description:
        "Adopt the reviewed disk content version and discard the old field edits/proposals explicitly. Refuses if the disk changed again.",
      input: z.object({ member: podMemberSchema, versionToken: z.string() }),
      actor: "human",
    },
    refresh: {
      description: "Re-read the bound member. Proposals and staged values are preserved.",
      input: z.object({}),
      actor: "any",
    },
    validate: {
      description:
        "Validate the document with staged values spliced in (and proposals too when includeProposals is true) without saving. Use this to prove a proposal is schema-valid before the human stages it.",
      input: z.object({ includeProposals: z.boolean().optional() }),
      actor: "any",
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
  let inherited: string[] | null = null;
  for (const [index, segment] of segments.entries()) {
    if (cursor == null || typeof cursor !== "object") return inherited;
    const object = cursor as Record<string, unknown>;
    if (
      ("$preset" in object || "$include" in object) &&
      !(index === segments.length - 1 && segment.startsWith("$"))
    ) {
      const directive = object.$preset ?? object.$include;
      inherited = (Array.isArray(directive) ? directive : [directive]).filter(
        (value): value is string => typeof value === "string",
      );
      if ("$include" in object || !Object.hasOwn(object, segment)) return inherited;
    }
    if (!Object.hasOwn(object, segment)) return inherited;
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

/** One pure candidate builder for the command, Settings form and Family projection. */
export function settingsCandidate(
  rawContent: string,
  fields: Record<string, SettingsFieldState>,
  includeProposals = false,
): string {
  const edits = Object.entries(fields).filter(
    ([, field]) => field.staged || (includeProposals && field.proposal),
  );
  if (!edits.length) return rawContent;
  const raw = edits.find(([pointer]) => pointer === "");
  if (raw) {
    if (edits.length !== 1)
      throw new Error(
        "Review either raw text or structured edits; clear the other staged edits first.",
      );
    const edit = raw[1].staged ?? raw[1].proposal!;
    if (edit.delete || typeof edit.value !== "string")
      throw new Error("The root edit must contain exact raw text.");
    return edit.value;
  }
  const root: unknown = JSON.parse(rawContent.replace(/^\uFEFF/, ""));
  if (root === null || typeof root !== "object" || Array.isArray(root))
    throw new Error("The authored JSON must be an object before fields can be edited.");
  for (const [pointer, field] of edits) {
    const segments = settingsFieldSegments(pointer);
    if (
      !segments.length ||
      segments.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
    )
      throw new Error("A field edit must address a safe non-root JSON pointer.");
    if (settingsFieldDirectives(root, segments))
      throw new Error("This value belongs to a shared fragment. Open that fragment to edit it.");
    const edit = field.staged ?? field.proposal!;
    let cursor = root as Record<string, unknown>;
    for (const key of segments.slice(0, -1)) {
      if (Array.isArray(cursor) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= cursor.length))
        throw new Error("Array edits require an existing numeric index.");
      const next = cursor[key];
      if (next == null) cursor[key] = {};
      else if (typeof next !== "object")
        throw new Error(`Cannot edit through non-object field ${key}.`);
      cursor = cursor[key] as Record<string, unknown>;
    }
    const leaf = segments.at(-1)!;
    if (Array.isArray(cursor) && (!/^(0|[1-9][0-9]*)$/.test(leaf) || Number(leaf) >= cursor.length))
      throw new Error("Array edits require an existing numeric index.");
    if (edit.delete && Array.isArray(cursor)) cursor.splice(Number(leaf), 1);
    else if (edit.delete) delete cursor[leaf];
    else cursor[leaf] = edit.value;
  }
  return JSON.stringify(root, null, 2);
}

/** An authored projection, never a fresh disk observation. Invalid raw content remains visible. */
export function settingsWorkSnapshot(
  work: SettingsRouteDocument,
  staged = false,
): SettingsSnapshot | null {
  if (!work.basis) return null;
  let rawContent = work.basis.rawContent;
  try {
    if (staged) rawContent = settingsCandidate(rawContent, work.fields);
    JSON.parse(rawContent.replace(/^\uFEFF/, ""));
    return {
      ...work.basis,
      rawContent,
      composedContent: rawContent,
      validation: { isValid: true, issues: [] },
    };
  } catch (error) {
    return {
      ...work.basis,
      rawContent,
      composedContent: null,
      validation: {
        isValid: false,
        issues: [
          {
            code: "JsonParseError",
            message: error instanceof Error ? error.message : String(error),
            path: "$",
            severity: "error",
          },
        ],
      },
    };
  }
}
