import {
  canonicalRouteInput,
  scheduleReadingSchema,
  workKey,
  type ActionReceipt,
  type ScheduleGridDocument,
  type ScheduleReading,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import type { BindingScope, MountBinding } from "#/shell/mount-owner";
import type { SchedulesPage } from "./graph";
import { isSpecOf } from "#/route/workflow";
import { sameScheduleRows, SCHEDULE_SPEC_SCHEMA } from "./graph";

export type SchedulesScope = BindingScope<SchedulesPage, ScheduleGridDocument>;
export const readingValue = <T>(scope: SchedulesScope, id: string) =>
  (scope.readings[id]?.value ?? scope.readings[id]?.previous ?? null) as T | null;

export function shownSchedule(scope: SchedulesScope): ScheduleReading | null {
  const retained = readingValue<ScheduleReading>(scope, "retained");
  const saved = readingValue<ScheduleReading>(scope, "saved");
  if (scope.page.stage === "history") return saved;
  const doc = scope.work?.doc;
  if (!Object.values(doc?.cells ?? {}).some((cell) => cell.edit || cell.suggestion) || !doc?.basis)
    return retained ?? saved;
  return retained &&
    saved &&
    retained.id !== doc.basis.captureId &&
    sameScheduleRows(saved, retained)
    ? retained
    : (saved ?? (retained?.id === doc.basis.captureId ? retained : null));
}

export function scheduleEditRefusal(scope: SchedulesScope): string | null {
  if (scope.page.stage === "history") return "History is inspection only";
  if (
    !scope.work ||
    scope.work.handle.key.binding !== "workspace" ||
    scope.work.handle.key.work !== scope.page.workspaceId
  )
    return "Review the exact schedule Work binding first";
  const shown = shownSchedule(scope);
  if (!shown || !scope.work.doc.basis) return "Read and bind the schedule before editing";
  if (
    shown.workspaceId !== scope.page.workspaceId ||
    scope.target.kind !== "document" ||
    canonicalRouteInput(shown.target) !== canonicalRouteInput(scope.target.ref)
  )
    return "Read the schedule again in this exact document lifetime";
  return null;
}

export function schedulesBinding(id: string, row: unknown, scope: SchedulesScope): MountBinding {
  const noSubject = (args: unknown) => ({ subject: null, args });
  if (id === "edit") return noSubject({ ...(row as object), refusal: scheduleEditRefusal(scope) });
  if (id === "read") {
    const selected = row as { scheduleId?: number } | null;
    const shown = shownSchedule(scope);
    return noSubject(
      selected?.scheduleId
        ? { scheduleId: selected.scheduleId }
        : shown
          ? { scheduleId: shown.snapshot.scheduleId }
          : {},
    );
  }
  if (id === "bind")
    return noSubject({
      readingId: shownSchedule(scope)?.id ?? "",
      expectedRevision: scope.work?.handle.revision ?? 0,
    });
  if (id === "push") {
    const receipts = readingValue<ActionReceipt[]>(scope, "receipts") ?? [];
    const unresolved = receipts.some(
      (receipt) =>
        ["running", "unknown", "incomplete", "waiting"].includes(receipt.state) &&
        receipt.consumes.some(
          (input) =>
            input.kind === "work" &&
            scope.work &&
            workKey(input.probe.handle.key) === workKey(scope.work.handle.key),
        ),
    );
    const basis = readingValue<ScheduleReading>(scope, "saved");
    const refusal =
      scheduleEditRefusal(scope) ??
      (scope.page.path ? "Unstage or apply the edited cells before opening a spec" : null) ??
      (!Object.values(scope.work?.doc.cells ?? {}).some((cell) => cell.edit)
        ? "Edit a cell first"
        : null) ??
      (!scope.readings.saved?.current ||
      !scope.readings.receipts?.current ||
      basis?.id !== scope.work?.doc.basis?.captureId
        ? "Wait for the schedule basis and receipts to finish reading"
        : null) ??
      (unresolved ? "Recover or resume the outstanding receipt before a new push" : null);
    return noSubject({ pod: scope.page.pod || undefined, refusal });
  }
  if (id === "capture") {
    const retained = readingValue<ScheduleReading>(scope, "retained");
    const parsed = scheduleReadingSchema.safeParse(retained);
    return noSubject({
      pod: scope.page.pod,
      scheduleId: parsed.data?.snapshot.scheduleId,
      refusal: !scope.page.pod
        ? "Choose the pod the capture lands in"
        : !parsed.success
          ? "Open a schedule in the grid first"
          : scope.target.kind !== "document" ||
              canonicalRouteInput(parsed.data.target) !== canonicalRouteInput(scope.target.ref)
            ? "Read the schedule in this exact document lifetime first"
            : null,
    });
  }
  if (id === "apply") {
    const pods = readingValue<PodList["pods"]>(scope, "pods");
    const member = pods
      ?.find((pod) => pod.id === scope.page.pod)
      ?.members.find((member) => member.path === scope.page.path);
    return noSubject({
      source: member
        ? { pod: scope.page.pod, path: member.path, sha256: member.sha256 }
        : undefined,
      refusal:
        !scope.page.pod || !scope.page.path
          ? "Open a saved schedule spec first"
          : !scope.readings.pods?.current || !member
            ? "Wait for the saved spec's current bytes"
            : !isSpecOf(member.schema, SCHEDULE_SPEC_SCHEMA)
              ? "The member is not a schedule spec"
              : Object.values(scope.work?.doc.cells ?? {}).some((cell) => cell.edit)
                ? "Unstage or apply the edited cells first"
                : null,
    });
  }
  return noSubject(row ?? {});
}
