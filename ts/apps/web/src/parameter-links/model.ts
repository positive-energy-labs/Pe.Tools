import {
  canonicalRouteInput,
  parameterLinksBasis,
  stagedParameterProfile,
} from "@pe/agent-contracts";
import type {
  ParameterLinksReading,
  ParameterLinkAssignment,
  ParameterLinkDefinition,
  ParameterLinkEvaluation,
  ParameterLinkProfile,
  ParameterLinksDocument,
} from "@pe/agent-contracts";

export type SourceKind = ParameterLinkDefinition["sourceScope"];
export type Relationship = ParameterLinkDefinition["relationship"];
export type Reducer = ParameterLinkDefinition["reducer"];

export const SOURCE_SCOPES: SourceKind[] = ["instance", "type", "instanceThenType"];
export const RELATIONSHIPS: Relationship[] = ["sameElement", "electricalEquipmentCircuits"];
export const REDUCERS: Reducer[] = ["first", "min", "max"];

export function sameProfile(
  left: ParameterLinkProfile | null | undefined,
  right: ParameterLinkProfile | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Freshness, computed exactly as the server computes it before it admits an apply: an
 * evaluation belongs to the draft named by its basis, and to no other.
 */
function evaluationIsCurrent(
  document: ParameterLinksDocument | null,
  reading: ParameterLinksReading | null,
): boolean {
  if (!document || !stagedParameterProfile(document) || !reading?.evaluated) return false;
  return reading.basis === parameterLinksBasis(document);
}

export function isDraftDirty(
  document: ParameterLinksDocument | null,
  reading: ParameterLinksReading | null,
): boolean {
  const draft = document ? stagedParameterProfile(document) : null;
  if (draft == null) return false;
  return !sameProfile(draft, reading?.stored);
}

function errorIssueCount(evaluation: ParameterLinkEvaluation | null | undefined): number {
  return evaluation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
}

/** One refusal string, so the strip and the verb can never disagree about why. */
/** The host's refusal for applying a proposal preview (`family-actions.ts`), word for word. */
const PROPOSAL_PREVIEW_REFUSAL =
  "The reviewed reading is a proposal preview; stage the profile and preview again";

/** A profile said as one line: how much it links. */
export const profileSummary = (profile: ParameterLinkProfile | null | undefined) =>
  profile
    ? `${profile.definitions.length} definition${profile.definitions.length === 1 ? "" : "s"} · ${profile.assignments.length} assignment${profile.assignments.length === 1 ? "" : "s"}`
    : "no profile";

export function applyRefusal(
  document: ParameterLinksDocument | null,
  reading: ParameterLinksReading | null,
): string | null {
  // A preview of Pea's proposal never arms apply: the host's words, said on the web first.
  if (reading?.subject === "proposal") return PROPOSAL_PREVIEW_REFUSAL;
  if (!document || !stagedParameterProfile(document)) return "Author a draft profile first.";
  if (!evaluationIsCurrent(document, reading)) return "Preview this draft before applying.";
  if (errorIssueCount(reading?.evaluation) > 0)
    return "Resolve the evaluation errors before applying.";
  return null;
}

let sequence = 0;
function freshId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function blankDefinition(id = freshId("def")): ParameterLinkDefinition {
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

function blankAssignment(definitionId: string, id = freshId("asn")): ParameterLinkAssignment {
  return { id, definitionId, enabled: true, sourceElementUniqueIds: [] };
}

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

export interface ProfileChange {
  kind: "definition" | "assignment";
  id: string;
  change: "added" | "removed" | "changed";
  /** The fields that differ, for `changed`. */
  fields: string[];
}

/** What accepting `proposed` would change against `staged`, matched by id; unchanged items are left out. */
export function profileDiff(
  staged: ParameterLinkProfile | null | undefined,
  proposed: ParameterLinkProfile | null | undefined,
): ProfileChange[] {
  const side = <T extends { id: string }>(kind: ProfileChange["kind"], from: T[], to: T[]) => {
    const before = new Map(from.map((item) => [item.id, item]));
    const after = new Map(to.map((item) => [item.id, item]));
    const changes: ProfileChange[] = [];
    for (const [id, item] of after) {
      const was = before.get(id);
      if (!was) {
        changes.push({ kind, id, change: "added", fields: [] });
        continue;
      }
      const fields = [...new Set([...Object.keys(was), ...Object.keys(item)])].filter(
        (field) =>
          canonicalRouteInput((was as Record<string, unknown>)[field] ?? null) !==
          canonicalRouteInput((item as Record<string, unknown>)[field] ?? null),
      );
      if (fields.length) changes.push({ kind, id, change: "changed", fields });
    }
    for (const id of before.keys())
      if (!after.has(id)) changes.push({ kind, id, change: "removed", fields: [] });
    return changes;
  };
  return [
    ...side("definition", staged?.definitions ?? [], proposed?.definitions ?? []),
    ...side("assignment", staged?.assignments ?? [], proposed?.assignments ?? []),
  ];
}
