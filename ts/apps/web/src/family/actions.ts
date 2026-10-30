import { settingsCandidate, type FamilyDraft, type SettingsSnapshot } from "@pe/agent-contracts";
import type { BindingScope } from "#/shell/mount-owner";
import { familyLockOf } from "./store";
import type { FamilyPage } from "./graph";
import { readingValue } from "./sources";

export type FamilyScope = BindingScope<FamilyPage, FamilyDraft>;
export const familyWorkRefusal = (scope: FamilyScope) =>
  scope.page.stage === "history"
    ? "History is inspection only"
    : scope.work
      ? null
      : "Read the family Work first";

export function familyBinding(id: string, row: unknown, scope: FamilyScope) {
  const value = (row ?? {}) as Record<string, unknown>;
  const blocked = familyWorkRefusal(scope);
  if (id === "edit") return { subject: null, args: { ...value, refusal: blocked } };
  if (id === "saved")
    return { subject: null, args: { request: { id: value.readingId ?? "" }, refusal: null } };
  const profile = readingValue<SettingsSnapshot>(scope.readings.profile);
  const source = profile?.sha256 ? { ...profile.member, sha256: profile.sha256 } : null;
  if (id === "open") return { subject: null, args: { source: value.source, refusal: blocked } };
  if (id === "build")
    return {
      subject: null,
      args: {
        source,
        refusal:
          blocked ??
          (!source || !scope.readings.profile?.current
            ? "Wait for the current saved family profile"
            : profile?.validation?.isValid !== true
              ? "The saved family profile does not validate"
              : Object.values(scope.work?.doc.cells ?? {}).some((cell) => cell.edit)
                ? "Save the family edits before building the saved profile"
                : null),
      },
    };
  if (id === "apply")
    return {
      subject: null,
      args: {
        refusal:
          blocked ?? (scope.work?.doc.reading ? null : "Read or open a family before applying"),
      },
    };
  if (id === "capture") {
    let spec: string | undefined;
    let invalid: string | null = null;
    try {
      if (scope.work?.doc.reading)
        spec = settingsCandidate(scope.work.doc.reading, scope.work.doc.cells);
      if (spec) JSON.parse(spec.replace(/^\uFEFF/, ""));
    } catch (error) {
      invalid = error instanceof Error ? error.message : String(error);
    }
    return {
      subject: null,
      args: {
        pod: scope.page.pod || "",
        spec,
        refusal: blocked ?? invalid ?? (scope.page.pod ? null : "Choose a destination pod"),
      },
    };
  }
  return { subject: null, args: value };
}

export function familyCell(row: unknown, scope: FamilyScope) {
  const value = row as { key?: string } | undefined;
  if (!value?.key || !scope.work || familyWorkRefusal(scope)) return null;
  let authored: unknown = null;
  try {
    authored = JSON.parse(scope.work.doc.reading ?? "null");
  } catch {
    return null;
  }
  if (familyLockOf(authored)(value.key)) return null;
  return {
    type: "cell:cells",
    id: value.key,
    work: scope.work.handle.key,
    path: ["cells", value.key],
  };
}
