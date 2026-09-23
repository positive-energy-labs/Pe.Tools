/**
 * Member document — collaborative state for authoring one schema-backed pod member.
 *
 * Third instance of the proposal → staged → committed trichotomy (after parameter-links
 * cells and parameter-links draft/preview/apply). Fields are addressed by RFC 6901
 * JSON Pointers into the member's parsed raw content (e.g.
 * "/revit/units/length") — pointer escaping means property names may contain periods
 * and slashes (spec-sheet values like "M.2 Depth" address cleanly).
 * Pea proposes field values; the human stages them; the human-only `settings.write` action
 * splices staged values into the raw content and writes through `pod.member.write`
 * with the member sha256 explicitly adopted as its edit basis.
 */
import { z } from "zod";
import { type RouteStateSpec } from "./route-state.ts";
import { trichotomyAgentMask, trichotomyCellSchema } from "./trichotomy.ts";

/* ── Field trichotomy — the shared cell over any JSON value.
   A staged `{ value }` assigns JSON; `{ delete: true }` removes the property. ── */

/** One document citation for a proposed value, in markdown coordinates — pea never
 * sees a bbox. `blockId` may reference a parsed block OR a parser-extracted image;
 * the UI resolves geometry (measured/estimated) and refuses to draw what it can't. */
const settingsProposalSourceSchema = z.object({
  blockId: z.string(),
  rowIdx: z.number().int().nonnegative().optional(),
  colIdx: z.number().int().nonnegative().optional(),
  note: z.string().nullish(),
});
/** The one cell over any JSON value. Deletable: `/family` and the pods reviewer stage deletes. */
export const settingsFieldStateSchema = trichotomyCellSchema(z.unknown(), {
  deletable: true,
  proposal: {
    /** Multi-citation: one value may be grounded by several regions (a table
     * cell AND a figure). Order is presentation order. */
    sources: z.array(settingsProposalSourceSchema).nullish(),
  },
});
export type SettingsFieldState = z.infer<typeof settingsFieldStateSchema>;

/* ── Ephemeral member read (pod.member.read / pod.member.compose) ─────────── */

/** A pod member, everywhere: manifest `id` plus the member's pod-relative path. */
export const podMemberSchema = z.object({ pod: z.string().min(1), path: z.string().min(1) });
export type PodMember = z.infer<typeof podMemberSchema>;
/** The exact member bytes an apply consumed. */
export const podMemberSourceSchema = podMemberSchema.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PodMemberSource = z.infer<typeof podMemberSourceSchema>;
/**
 * An unsaved draft consumed as supplied bytes: nothing is filed. `pod`, when present, is real
 * composition context for `@local`; `path` names the draft in the run evidence.
 */
export const podDraftSourceSchema = z.object({
  pod: z.string().min(1).optional(),
  path: z.string().min(1),
  content: z.string(),
});
export type PodDraftSource = z.infer<typeof podDraftSourceSchema>;
/** The Work key of an authored member: derived from its address, never stored beside it. */
export const memberWork = (member: PodMember): string => `member:${member.pod}/${member.path}`;

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
  sha256: z.string().nullable(),
  observedAt: z.iso.datetime().optional(),
  /** Raw JSON text as stored in the pod — the save target. */
  rawContent: z.string(),
  /** Composed content (directives resolved), display-only. */
  composedContent: z.string().nullish(),
  /** The fragments composition consumed, by installed pod id. */
  dependencies: z
    .array(z.object({ id: z.string(), path: z.string(), sha256: z.string() }))
    .optional(),
  validation: settingsValidationSchema.nullish(),
});
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;

/* ── The document ──────────────────────────────────────────────────────────── */

export const settingsBasisSchema = z.object({
  member: podMemberSchema,
  rawContent: z.string(),
  sha256: z.string().min(1),
});
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
  commands: {},
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

/** Whether every segment names an existing object property or array index. */
const resolves = (root: unknown, segments: string[]) => {
  let cursor = root;
  for (const key of segments) {
    if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, key)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor !== null && typeof cursor === "object";
};

/** One pure candidate builder for the command, Settings form and Family projection. */
export function settingsCandidate(
  rawContent: string,
  fields: Record<string, SettingsFieldState>,
  includeProposals = false,
): string {
  const edits = Object.entries(fields).filter(
    ([, field]) => field.staged || (includeProposals && field.proposal),
  );
  // A root edit is the person's raw text: it replaces the basis, and pointer edits apply on top.
  const raw = edits.find(([pointer]) => pointer === "")?.[1];
  const rootEdit = raw ? (raw.staged ?? raw.proposal!) : null;
  if (rootEdit && (rootEdit.delete || typeof rootEdit.value !== "string"))
    throw new Error("The root edit must contain exact raw text.");
  const base = rootEdit ? (rootEdit.value as string) : rawContent;
  const pointers = edits.filter(([pointer]) => pointer !== "");
  if (!pointers.length) return base;
  const parse = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ""));
  const root = parse(base);
  if (root === null || typeof root !== "object" || Array.isArray(root))
    throw new Error("The authored JSON must be an object before fields can be edited.");
  let basisRoot: unknown;
  try {
    basisRoot = rootEdit ? parse(rawContent) : root;
  } catch {
    basisRoot = undefined;
  }
  for (const [pointer, field] of pointers) {
    const segments = settingsFieldSegments(pointer);
    // A staged field whose container the person's raw edit removed has nowhere to land.
    const parent = segments.slice(0, -1);
    if (rootEdit && resolves(basisRoot, parent) && !resolves(root, parent))
      throw new Error(`Staged field ${pointer} no longer resolves in the edited draft.`);
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
