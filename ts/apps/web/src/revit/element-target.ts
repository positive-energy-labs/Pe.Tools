import { documentRefSchema, type ActionReceipt, type DocumentRef } from "@pe/agent-contracts";
import { revitTarget, type RevitElementReference } from "@pe/kit/lang/row";
import type { OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";
import type { DetachedAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

type RevitTargetSource = "native" | "fixture" | "saved" | "dry-run";
/** Construct from the displayed observation, never the current route selector or thread head. */
export type RevitObservationScope = {
  document: DocumentRef | null;
  source: RevitTargetSource;
  /** The observation's existing native document key, needed when its handles carry one. */
  documentKey?: string;
  /** Identity of the displayed reading, used to fence deferred native resolution. */
  observationId?: string;
};
export type FamilyPlacementTarget = Pick<
  OpRequestOf<"revit.resolve.family-instances">,
  "familyId" | "familyUniqueId"
>;
export type ElementTarget = {
  ids: readonly number[];
  refs?: readonly RevitElementReference[];
  family?: FamilyPlacementTarget;
  /** A deferred target must still belong to the same mounted observation at dispatch. */
  isCurrent?: () => boolean;
  scope: RevitObservationScope | DocumentRef | null;
};

export const revitReferences = (refs: readonly RevitElementReference[]) => revitTarget(null, refs);
export const revitFamily = (family: FamilyPlacementTarget) => ({
  "data-revit-family": JSON.stringify({
    familyId: family.familyId,
    familyUniqueId: family.familyUniqueId,
  }),
});

export type PreparedElements =
  | { kind: "refused"; code: string; message: string }
  | {
      kind: "family";
      document: DocumentRef;
      scope: RevitObservationScope;
      request: OpRequestOf<"revit.resolve.family-instances">;
    }
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
  if (target.family !== undefined) {
    if (target.ids.length || target.refs?.length)
      return refuse(
        "FamilyTargetMixed",
        "A family placement target cannot include unrelated elements.",
      );
    if (
      typeof scope.observationId !== "string" ||
      !scope.observationId.trim() ||
      !target.isCurrent?.()
    )
      return refuse("ObservationChanged", "The displayed family reading is no longer current.");
    const family = target.family;
    if (
      !family ||
      !Number.isSafeInteger(family.familyId) ||
      family.familyId <= 0 ||
      typeof family.familyUniqueId !== "string" ||
      !family.familyUniqueId.trim()
    )
      return refuse("FamilyIdentityMissing", "The captured family ID and UniqueId are required.");
    return {
      kind: "family",
      document: document.data,
      scope: { ...scope, document: document.data },
      request: {
        familyId: family.familyId,
        familyUniqueId: family.familyUniqueId,
        maxResults: 500,
      },
    };
  }
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
  const host = el?.closest<HTMLElement>("[data-revit-ids], [data-revit-refs], [data-revit-family]");
  if (!host) return null;
  try {
    const rawIds = host.dataset.revitIds;
    // Number('') is zero; reject empty tokens rather than silently discarding them.
    const ids =
      rawIds === undefined
        ? []
        : rawIds.split(",").map((id) => (/^\d+$/.test(id) ? Number(id) : NaN));
    const rawRefs = host.dataset.revitRefs;
    const refs: unknown = rawRefs ? JSON.parse(rawRefs) : undefined;
    if (
      refs !== undefined &&
      (!Array.isArray(refs) || refs.some((ref) => !ref || typeof ref !== "object"))
    )
      return { ids: [NaN], scope: null };
    const scopeHost = host.closest<HTMLElement>("[data-revit-scope]");
    const raw = scopeHost?.dataset.revitScope;
    const scope = raw ? JSON.parse(raw) : null;
    const rawFamily = host.dataset.revitFamily;
    return {
      ids,
      refs: refs as RevitElementReference[] | undefined,
      family: rawFamily === undefined ? undefined : JSON.parse(rawFamily),
      scope,
      isCurrent: () =>
        host.isConnected &&
        host.closest("[data-revit-scope]") === scopeHost &&
        host.dataset.revitIds === rawIds &&
        host.dataset.revitRefs === rawRefs &&
        host.dataset.revitFamily === rawFamily &&
        scopeHost?.isConnected === true &&
        scopeHost.dataset.revitScope === raw,
    };
  } catch {
    return { ids: [NaN], scope: null };
  }
}

/** A complete native family result is the only set that may become an element action. */
export function prepareFamilyPlacements(
  data: OpResponseOf<"revit.resolve.family-instances">,
  family: FamilyPlacementTarget,
  scope: ElementTarget["scope"],
  selectOnly: boolean,
): PreparedElements {
  const refuse = (code: string, message: string): PreparedElements => ({
    kind: "refused",
    code,
    message,
  });
  if (data.familyId !== family.familyId || data.familyUniqueId !== family.familyUniqueId)
    return refuse("FamilyIdentityMismatch", "The resolver answered for another family identity.");
  const errors = data.issues.filter((issue) => issue.severity === "Error");
  if (errors.length)
    return refuse("FamilyResolutionRefused", errors.map((issue) => issue.message).join(" "));
  if (data.page.isTruncated)
    return refuse(
      "FamilyInstancesTruncated",
      "The family placement result is incomplete; nothing was selected or boxed.",
    );
  if (!data.instances.length)
    return refuse(
      "FamilyHasNoPlacedInstances",
      "This family has no current placements to select or box.",
    );
  if (
    data.instances.length > 500 ||
    data.page.returnedCount !== data.instances.length ||
    data.page.totalCount !== data.instances.length ||
    data.instances.some(
      (instance) =>
        typeof instance.elementUniqueId !== "string" || !instance.elementUniqueId.trim(),
    )
  )
    return refuse(
      "FamilyInstancesIncomplete",
      "The resolver did not return a complete set of paired instance identities.",
    );
  return prepareElements(
    {
      ids: [],
      refs: data.instances.map((instance) => ({
        kind: "Element",
        elementId: instance.elementId,
        uniqueId: instance.elementUniqueId,
      })),
      scope,
    },
    selectOnly,
  );
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
  // I1: counts and messages, never element ids; the pointer already says which elements.
  const issues = [...new Set(data.issues.map((issue) => issue.message))].join("; ");
  const n = (count: number) => `${count} element${count === 1 ? "" : "s"}`;
  const unverified = data.shown.filter((id) => !data.identityVerified.includes(id));
  return [
    data.note,
    data.missing.length ? `Missing: ${n(data.missing.length)}.` : "",
    data.hidden.length ? `Still hidden in the view: ${n(data.hidden.length)}.` : "",
    issues,
    unverified.length
      ? `${unverified.length} ID-only target(s); stale identity was not verified.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
