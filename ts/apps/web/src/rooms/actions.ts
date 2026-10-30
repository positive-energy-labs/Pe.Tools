import { stagedRoomWrites, type RoomsRouteDocument } from "@pe/agent-contracts";
import type { BindingScope, MountBinding } from "#/shell/mount-owner";
import type { ReadingState } from "#/shell/readings";
import type { RoomsPage } from "./graph";

export type RoomsScope = BindingScope<RoomsPage, RoomsRouteDocument>;
export const readingValue = <T>(reading: ReadingState): T | null =>
  (reading.value ?? reading.previous ?? null) as T | null;

export function roomsWorkRefusal(scope: RoomsScope) {
  return scope.page.stage === "history"
    ? "History is inspection only"
    : !scope.work || scope.unreadable
      ? "The saved Work cannot be read"
      : null;
}

export function roomsBinding(id: string, row: unknown, scope: RoomsScope): MountBinding {
  const bound = (args: unknown) => ({ subject: null, args });
  const refusal = roomsWorkRefusal(scope);
  if (id === "edit") return bound({ ...(row as object), refusal });
  if (id === "delete-note")
    return bound({
      ...(row as object),
      expectedRevision: scope.work?.handle.revision ?? -1,
      refusal,
    });
  const native =
    scope.page.demo === "plan" && scope.page.live === undefined
      ? "The fixture plan cannot write Revit"
      : null;
  const ready = refusal ?? native;
  if (id === "partition") {
    const rejected = Object.values(scope.work?.doc.marks ?? {})
      .map((cell) => cell.edit?.value)
      .filter((mark) => mark?.kind === "reject" && mark.anchor.view === scope.page.view)
      .map((mark) => mark!.anchor.polygon);
    return bound({
      request: { view: scope.page.view, ...(rejected.length ? { rejected } : {}) },
      refusal: ready ?? (!scope.page.view ? "Pick a plan view" : null),
    });
  }
  if (id === "apply")
    return bound({
      request: { regions: scope.work ? stagedRoomWrites(scope.work.doc) : [] },
      refusal:
        ready ??
        (!Object.values(scope.work?.doc.edits ?? {}).some((cell) => cell.edit)
          ? "Nothing edit"
          : null),
    });
  if (id === "merge")
    return bound({
      request: { view: scope.page.view, guids: scope.page.selected },
      refusal:
        ready ??
        (!scope.page.view
          ? "Pick a plan view"
          : scope.page.selected.length < 2
            ? "Shift-click two or more rooms"
            : null),
    });
  if (id === "applyMark") {
    const mark = scope.work?.doc.marks[(row as { id?: string } | undefined)?.id ?? ""]?.edit?.value;
    return bound({
      request: { view: mark?.anchor.view ?? "", guids: mark?.guids ?? [] },
      refusal:
        ready ??
        (mark?.kind !== "merge"
          ? "Not a edit merge mark"
          : (mark.guids?.length ?? 0) < 2
            ? "The mark covers fewer than two regions"
            : null),
    });
  }
  return bound({});
}
