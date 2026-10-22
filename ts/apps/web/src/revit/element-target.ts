import { documentRefSchema, type ActionReceipt, type DocumentRef } from "@pe/agent-contracts";
import { revitTarget, type RevitElementReference } from "@pe/kit/lang/row";
import type { OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import type { DetachedAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export type RevitTargetSource = "native" | "fixture" | "saved" | "dry-run";
/** Construct from the displayed observation, never the current route selector or thread head. */
export type RevitObservationScope = {
  document: DocumentRef | null;
  source: RevitTargetSource;
  /** The observation's existing native document key, needed when its handles carry one. */
  documentKey?: string;
};
export type ElementTarget = {
  ids: readonly number[];
  refs?: readonly RevitElementReference[];
  scope: RevitObservationScope | DocumentRef | null;
};

/** Null and legacy scope declarations form a boundary too: they never inherit a parent scope. */
export const revitScope = (scope: ElementTarget["scope"] | undefined) => ({
  "data-revit-scope": JSON.stringify(scope ?? null),
});
export const revitReferences = (refs: readonly RevitElementReference[]) => revitTarget(null, refs);

export type PreparedElements =
  | { kind: "refused"; code: string; message: string }
  | { kind: "ready"; document: DocumentRef; request: OpRequestOf<"revit.context.show-elements"> };

export function prepareElements(target: ElementTarget, selectOnly: boolean): PreparedElements {
  const refuse = (code: string, message: string): PreparedElements => ({
    kind: "refused",
    code,
    message,
  });
  const scope = target.scope;
  if (!scope || typeof scope !== "object" || !("document" in scope))
    return refuse(
      "ObservationScopeMissing",
      "The displayed observation has no native document scope.",
    );
  if (scope.source !== "native")
    return refuse(
      "SourceNotNative",
      `Revit actions are unavailable for ${scope.source ?? "unknown"} data.`,
    );
  const document = documentRefSchema.safeParse(scope.document);
  if (!document.success)
    return refuse(
      "DocumentLifetimeMissing",
      "The displayed observation has no exact open document lifetime.",
    );
  const ids = [...target.ids];
  const expectedUniqueIds: Record<string, string> = {};
  for (const ref of target.refs ?? []) {
    if (
      ref.documentKey !== undefined &&
      (!scope.documentKey || ref.documentKey !== scope.documentKey)
    )
      return refuse(
        "HandleDocumentUnverified",
        "This handle does not belong to the displayed native document. Nested linked targets are unsupported.",
      );
    if (ref.kind !== undefined && ref.kind !== "Element")
      return refuse(
        "HandleKindUnsupported",
        `${ref.kind} handles are not concrete element targets.`,
      );
    if (ref.linkInstanceIds?.length)
      return refuse(
        "NestedLinkUnsupported",
        "Nested linked elements need an explicit native link path; Select and Selection Box are unavailable.",
      );
    if (!Number.isSafeInteger(ref.elementId) || ref.elementId === null || ref.elementId <= 0)
      return refuse("ElementIdInvalid", "A positive safe native element ID is required.");
    ids.push(ref.elementId);
    if (ref.uniqueId != null) {
      if (typeof ref.uniqueId !== "string" || !ref.uniqueId.trim())
        return refuse("UniqueIdInvalid", "An expected UniqueId cannot be empty.");
      const prior = expectedUniqueIds[ref.elementId];
      if (prior !== undefined && prior !== ref.uniqueId)
        return refuse(
          "IdentityConflict",
          `Element ${ref.elementId} has conflicting captured UniqueIds.`,
        );
      expectedUniqueIds[ref.elementId] = ref.uniqueId;
    }
  }
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    return refuse("ElementIdInvalid", "Element IDs must be positive safe integers.");
  return {
    kind: "ready",
    document: document.data,
    request: { elementIds: [...new Set(ids)], selectOnly, expectedUniqueIds },
  };
}

export function elementTargetOf(el: Element | null): ElementTarget | null {
  const host = el?.closest<HTMLElement>("[data-revit-ids], [data-revit-refs]");
  if (!host) return null;
  try {
    const rawIds = host.dataset.revitIds;
    // Number('') is zero; reject empty tokens rather than silently discarding them.
    const ids =
      rawIds === undefined
        ? []
        : rawIds.split(",").map((id) => (/^\d+$/.test(id) ? Number(id) : NaN));
    const refs: unknown = host.dataset.revitRefs ? JSON.parse(host.dataset.revitRefs) : undefined;
    if (
      refs !== undefined &&
      (!Array.isArray(refs) || refs.some((ref) => !ref || typeof ref !== "object"))
    )
      return { ids: [NaN], scope: null };
    const raw = host.closest<HTMLElement>("[data-revit-scope]")?.dataset.revitScope;
    const scope = raw ? JSON.parse(raw) : null;
    return { ids, refs: refs as RevitElementReference[] | undefined, scope };
  } catch {
    return { ids: [NaN], scope: null };
  }
}

export type ShowElementsResult =
  | Extract<PreparedElements, { kind: "refused" }>
  | {
      kind: "action";
      action: ActionReceipt | DetachedAction;
      data: OpResponseOf<"revit.context.show-elements"> | null;
      message: string;
    }
  | { kind: "failed"; message: string; error: unknown };

export function showElementsMessage(result: ShowElementsResult): string {
  if (result.kind !== "action" || !result.data) return result.message;
  const data = result.data;
  const issues = data.issues.map((issue) => `${issue.elementId}: ${issue.message}`).join("; ");
  const unverified = data.shown.filter((id) => !data.identityVerified.includes(id));
  return [
    data.note,
    data.missing.length ? `Missing: ${data.missing.join(", ")}.` : "",
    data.hidden.length ? `Still hidden in the view: ${data.hidden.join(", ")}.` : "",
    issues,
    unverified.length
      ? `${unverified.length} ID-only target(s); stale identity was not verified.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
