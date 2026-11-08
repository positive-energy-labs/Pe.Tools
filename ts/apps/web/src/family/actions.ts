import type { FamilyDraft } from "@pe/agent-contracts";
import type { WorkHandle } from "@pe/agent-contracts";
import { familyLockOf } from "./store";
import type { FamilyPage } from "./page";

export type FamilyScope = { page: FamilyPage; work: { handle: WorkHandle; doc: FamilyDraft } | null };
export const familyWorkRefusal = (scope: FamilyScope) =>
  scope.page.stage === "history"
    ? "History is inspection only"
    : scope.work
      ? null
      : "Read the family Work first";

/** Test-only forwarding binding: the frozen graph declares only edit. */
export function familyBinding(_id: string, row: unknown, scope: FamilyScope) {
  return {
    subject: null,
    args: { ...(row as Record<string, unknown>), refusal: familyWorkRefusal(scope) },
  };
}

export function familyCell(row: unknown, scope: FamilyScope) {
  const value = row as { key?: string } | undefined;
  if (!value?.key || !scope.work || familyWorkRefusal(scope)) return null;
  let authored: unknown = null;
  try {
    authored = JSON.parse(scope.work.doc.reading ?? "null");
  } catch (error) {
    console.warn("ts/apps/web/src/family/actions.ts: fallback after failure", error);
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
