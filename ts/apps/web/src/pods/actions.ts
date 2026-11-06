import { memberWork, type SettingsRouteDocument, type WorkKey } from "@pe/agent-contracts";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { PodsPage } from "./page.ts";
import {
  draftOf,
  readingValue,
  sameMember,
  selectedMember,
  type MemberRead,
  type CompositionRead,
} from "./model.ts";

export interface PodsScope {
  page: Readonly<Pick<PodsPage, "pod" | "path"> & Partial<Pick<PodsPage, "pendingDraft">>>;
  work: SettingsRouteDocument | null;
  workKey: WorkKey | null;
  readings: Readonly<Record<string, ReadingSnapshot<unknown>>>;
}
export function memberWorkRefusal(scope: PodsScope) {
  const ref = selectedMember(scope.page);
  if (!ref || !ref.path.endsWith(".json")) return "Pick a JSON member first.";
  return !scope.work || scope.workKey?.work !== memberWork(ref)
    ? "Select this member's Work first."
    : null;
}
export function editRefusal(scope: PodsScope) {
  const blocked = memberWorkRefusal(scope);
  if (blocked) return blocked;
  const read = readingValue<MemberRead>(scope.readings.member);
  const basis = scope.work?.basis;
  return !basis || !sameMember(basis.member, selectedMember(scope.page))
    ? "Open the saved member's bytes first."
    : !scope.readings.member?.current || !sameMember(read?.member, basis.member)
      ? "Wait for the current saved member bytes."
      : read?.sha256 !== basis.sha256
        ? "The member changed on disk; adopt its new bytes before editing."
        : null;
}
export function saveRefusal(scope: PodsScope) {
  const blocked = editRefusal(scope);
  if (blocked) return blocked;
  if (scope.page.pendingDraft) return "The draft is still being edited on the member.";
  try {
    const draft = draftOf(
      { page: scope.page, work: scope.work },
      readingValue<MemberRead>(scope.readings.member),
    );
    const value: unknown = JSON.parse(draft);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "A spec is a JSON object.";
    if (!Object.values(scope.work!.fields).some((field) => field.edit)) return "Nothing to save.";
    const composed = readingValue<CompositionRead>(scope.readings.composition);
    if (
      !scope.readings.composition?.current ||
      !sameMember(composed?.member, selectedMember(scope.page)) ||
      composed?.draft !== draft
    )
      return "The host is still checking this draft.";
    const errors = composed.result.diagnostics.filter((issue) => issue.severity === "error");
    return errors.length
      ? `The host called this draft invalid: ${errors[0]!.path || "the member"}: ${errors[0]!.message}`
      : null;
  } catch (error) {
    return `The draft is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}
export function openRefusal(scope: PodsScope, replaceEdits: boolean) {
  const read = readingValue<MemberRead>(scope.readings.member);
  return (
    memberWorkRefusal(scope) ??
    (!scope.readings.member?.current || !sameMember(read?.member, selectedMember(scope.page))
      ? "Wait for the current saved member bytes."
      : !replaceEdits && scope.work?.basis
        ? "This member already has a Work basis."
        : replaceEdits && (!scope.work?.basis || scope.work?.basis.sha256 === read?.sha256)
          ? "These are already the adopted bytes."
          : null)
  );
}
