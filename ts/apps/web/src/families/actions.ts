import {
  canonicalRouteInput,
  stagedFilter,
  workKey,
  type FamiliesRouteDocument,
  type ActionReceipt,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import type { BindingScope, MountBinding } from "#/shell/mount-owner";
import { isSpecOf } from "#/route/workflow";
import { FAMILIES_SPEC_SCHEMAS, type FamiliesPage } from "./graph";
import { draftFilter, scopeDraft, type FamiliesObservation } from "./sources";
import { editedFamilies } from "./staged";

export type FamiliesScope = BindingScope<FamiliesPage, FamiliesRouteDocument>;
export const readingValue = <T>(scope: FamiliesScope, id: string) =>
  (scope.readings[id]?.value ?? scope.readings[id]?.previous ?? null) as T | null;
export function familiesTargetReady(scope: FamiliesScope): string | null {
  const reading = readingValue<FamiliesObservation>(scope, "matrix");
  if (
    !reading ||
    !scope.readings.matrix?.current ||
    (reading.progress && reading.progress.state !== "complete")
  )
    return "Complete this Families read before planning edits";
  const doc = scope.work?.doc;
  if (doc?.patch.edit && editedFamilies(doc.cells).length)
    return "Stage either a native Family Foundry patch or per-type cells, not both";
  if (!doc || !stagedFilter(doc)) return "Stage a Families scope before planning edits";
  return scope.target.kind === "document" &&
    canonicalRouteInput(reading.document) === canonicalRouteInput(scope.target.ref) &&
    reading.capturedAt === doc.takenAt
    ? null
    : "Read these families in this exact document before planning their edits";
}
export function familiesEditRefusal(scope: FamiliesScope): string | null {
  const refusal = familiesWorkRefusal(scope);
  if (refusal) return refusal;
  const reading = readingValue<FamiliesObservation>(scope, "matrix");
  return !reading ||
    !scope.readings.matrix?.current ||
    scope.target.kind !== "document" ||
    canonicalRouteInput(reading.document) !== canonicalRouteInput(scope.target.ref)
    ? "Complete this Families read before editing cells"
    : null;
}
export function familiesWorkRefusal(scope: FamiliesScope): string | null {
  if (scope.page.stage === "history") return "History is inspection only";
  if (!scope.work || scope.unreadable) return "The saved Work cannot be read";
  return null;
}
export function familiesBinding(id: string, row: unknown, scope: FamiliesScope): MountBinding {
  const noSubject = (args: unknown) => ({ subject: null, args });
  const reading = readingValue<FamiliesObservation>(scope, "matrix");
  const history = scope.page.stage === "history" ? "History is inspection only" : null;
  if (id === "edit")
    return noSubject({
      ...(row as object),
      refusal: (row as { patches?: { path: readonly string[] }[] })?.patches?.some(
        (patch) => patch.path[0] === "cells",
      )
        ? familiesEditRefusal(scope)
        : familiesWorkRefusal(scope),
    });
  if (id === "exclude")
    return noSubject({ ...(row as object), refusal: familiesWorkRefusal(scope) });
  if (id === "propose")
    return noSubject({ ...(row as object), refusal: familiesEditRefusal(scope) });
  if (id === "read")
    return noSubject({
      request: {
        filter: draftFilter(scopeDraft(scope.page.draft, scope.work?.doc ?? null)),
        readId: crypto.randomUUID(),
        expectedRevision: scope.work?.handle.revision ?? 0,
      },
      refusal:
        history ??
        (!scope.work ? "Read the current Work first" : null) ??
        (!scopeDraft(scope.page.draft, scope.work?.doc ?? null).categories.length
          ? "Choose a category first"
          : scopeDraft(scope.page.draft, scope.work?.doc ?? null).families?.length === 0
            ? "Choose at least one family"
            : null),
    });
  if (id === "cancel-read")
    return noSubject({
      request: { readId: reading?.progress?.runId ?? "00000000-0000-4000-8000-000000000000" },
      refusal: reading?.progress?.state === "reading" ? null : "No family read is running",
    });
  if (id === "apply") {
    const member = readingValue<PodList["pods"]>(scope, "pods")
      ?.find((pod) => pod.id === scope.page.pod)
      ?.members.find((member) => member.path === scope.page.path);
    const unresolved = (readingValue<ActionReceipt[]>(scope, "receipts") ?? []).some(
      (receipt) =>
        ["running", "unknown", "incomplete", "waiting"].includes(receipt.state) &&
        receipt.consumes.some(
          (input) =>
            input.kind === "work" &&
            scope.work &&
            workKey(input.probe.handle.key) === workKey(scope.work.handle.key),
        ),
    );
    return noSubject({
      source: member
        ? { pod: scope.page.pod, path: member.path, sha256: member.sha256 }
        : undefined,
      refusal:
        history ??
        familiesTargetReady(scope) ??
        (scope.page.path && (!scope.readings.pods?.current || !member)
          ? "Wait for the saved spec's current bytes"
          : null) ??
        (member && !FAMILIES_SPEC_SCHEMAS.some((schema) => isSpecOf(member.schema, schema))
          ? "Choose a Family Foundry spec"
          : null) ??
        (!member &&
        !scope.work?.doc.patch.edit &&
        !editedFamilies(scope.work?.doc.cells ?? {}).length
          ? "Edit a cell or open a saved spec first"
          : null) ??
        (unresolved ? "Recover the outstanding receipt before applying again" : null),
    });
  }
  if (id === "capture")
    return noSubject({
      pod: scope.page.pod,
      familyIds: reading?.result.families.map((family) => family.familyId) ?? [],
      refusal:
        history ??
        familiesEditRefusal(scope) ??
        (!scope.page.pod ? "Choose the pod the capture lands in" : null),
    });
  if (id === "save-draft")
    return noSubject({
      pod: scope.page.pod,
      refusal:
        history ??
        (!scope.page.pod
          ? "Choose the pod the draft is saved in"
          : !editedFamilies(scope.work?.doc.cells ?? {}).length
            ? "Nothing is edited to save"
            : null),
    });
  return noSubject(row ?? {});
}
