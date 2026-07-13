/**
 * Parameter-links model — the pure, testable core the route-native workspace edits.
 *
 * The collaborative document lives at `route:parameter-links` (schema in
 * @pe/agent-contracts). Its `draftProfile` is the human/pea co-edited working copy;
 * `profile` is what Revit has stored. These helpers do the immutable draft edits and
 * the freshness math the workspace and the inline chat plugin both rely on — no React,
 * no I/O, so they can be unit-tested directly.
 */
import type {
  ParameterLinkAssignment,
  ParameterLinkDefinition,
  ParameterLinkEvaluation,
  ParameterLinkProfile,
  ParameterLinksDocument,
} from "@pe/agent-contracts";

export type SourceScope = ParameterLinkDefinition["sourceScope"];
export type Relationship = ParameterLinkDefinition["relationship"];
export type Reducer = ParameterLinkDefinition["reducer"];

export const SOURCE_SCOPES: SourceScope[] = ["instance", "type", "instanceThenType"];
export const RELATIONSHIPS: Relationship[] = ["sameElement", "electricalEquipmentCircuits"];
export const REDUCERS: Reducer[] = ["first", "min", "max"];

/** The profile the workspace edits: the draft when present, else the stored profile. */
export function editingProfile(
  document: ParameterLinksDocument | null,
): ParameterLinkProfile | null {
  return document?.draftProfile ?? document?.profile ?? null;
}

/** Structural equality over two profiles (order-sensitive; mirrors the command guard). */
export function sameProfile(
  left: ParameterLinkProfile | null | undefined,
  right: ParameterLinkProfile | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** The draft diverges from what Revit stored — the workspace shows an unsaved-draft badge. */
export function isDraftDirty(document: ParameterLinksDocument | null): boolean {
  const draft = document?.draftProfile;
  if (draft == null) return false;
  return !sameProfile(draft, document?.profile);
}

/** Error-severity issues block Apply; warnings do not. */
export function errorIssueCount(evaluation: ParameterLinkEvaluation | null | undefined): number {
  return evaluation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
}

/**
 * Apply is human-only and freshness-gated: the profile in hand must be exactly the one
 * last previewed (so the projected writes are trustworthy) and carry no blocking errors.
 */
export function canApply(args: {
  editing: ParameterLinkProfile | null;
  previewed: ParameterLinkProfile | null;
  errorCount: number;
}): boolean {
  const { editing, previewed, errorCount } = args;
  return (
    editing != null && previewed != null && errorCount === 0 && sameProfile(editing, previewed)
  );
}

/** Split a free-text list (newlines and/or commas) of element unique-ids into a clean array. */
export function parseUniqueIds(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Render a unique-id array back into the one-per-line textarea form. */
export function joinUniqueIds(ids: string[]): string {
  return ids.join("\n");
}

let sequence = 0;
/** A short, collision-resistant id for a freshly-created definition/assignment. */
export function freshId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function blankDefinition(id = freshId("def")): ParameterLinkDefinition {
  return {
    id,
    sourceCategoryId: 0,
    sourceParameter: { name: "" },
    sourceScope: "instanceThenType",
    relationship: "sameElement",
    targetParameter: { name: "" },
    reducer: "first",
  };
}

export function blankAssignment(
  definitionId: string,
  id = freshId("asn"),
): ParameterLinkAssignment {
  return { id, definitionId, enabled: true, sourceElementUniqueIds: [] };
}

/** A minimal, schema-valid profile seeded with one blank definition. */
export function blankProfile(): ParameterLinkProfile {
  return { formatVersion: 1, definitions: [blankDefinition()], assignments: [] };
}

/* ── immutable draft edits (each returns a new profile) ──────────────────────── */

export function addDefinition(profile: ParameterLinkProfile | null): ParameterLinkProfile {
  const base = profile ?? { formatVersion: 1, definitions: [], assignments: [] };
  return { ...base, definitions: [...base.definitions, blankDefinition()] };
}

export function updateDefinition(
  profile: ParameterLinkProfile,
  id: string,
  patch: Partial<ParameterLinkDefinition>,
): ParameterLinkProfile {
  return {
    ...profile,
    definitions: profile.definitions.map((def) => (def.id === id ? { ...def, ...patch } : def)),
  };
}

export function removeDefinition(profile: ParameterLinkProfile, id: string): ParameterLinkProfile {
  return {
    ...profile,
    definitions: profile.definitions.filter((def) => def.id !== id),
    // Orphaned assignments would fail evaluation — drop them with their definition.
    assignments: profile.assignments.filter((asn) => asn.definitionId !== id),
  };
}

export function addAssignment(
  profile: ParameterLinkProfile,
  definitionId: string,
): ParameterLinkProfile {
  return { ...profile, assignments: [...profile.assignments, blankAssignment(definitionId)] };
}

export function updateAssignment(
  profile: ParameterLinkProfile,
  id: string,
  patch: Partial<ParameterLinkAssignment>,
): ParameterLinkProfile {
  return {
    ...profile,
    assignments: profile.assignments.map((asn) => (asn.id === id ? { ...asn, ...patch } : asn)),
  };
}

export function removeAssignment(profile: ParameterLinkProfile, id: string): ParameterLinkProfile {
  return { ...profile, assignments: profile.assignments.filter((asn) => asn.id !== id) };
}
