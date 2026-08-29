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

export function editingProfile(
  document: ParameterLinksDocument | null,
): ParameterLinkProfile | null {
  return document?.draftProfile ?? document?.profile ?? null;
}

export function sameProfile(
  left: ParameterLinkProfile | null | undefined,
  right: ParameterLinkProfile | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function retainDraftBasis(
  basis: number | null,
  hasUnsavedEdits: boolean,
  revision: number | null,
): number | null {
  return hasUnsavedEdits ? basis : revision;
}

export function isDraftDirty(document: ParameterLinksDocument | null): boolean {
  const draft = document?.draftProfile;
  if (draft == null) return false;
  return !sameProfile(draft, document?.profile);
}

export function errorIssueCount(evaluation: ParameterLinkEvaluation | null | undefined): number {
  return evaluation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
}

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

export function parseUniqueIds(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

let sequence = 0;
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

export function blankProfile(): ParameterLinkProfile {
  return { formatVersion: 1, definitions: [blankDefinition()], assignments: [] };
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
