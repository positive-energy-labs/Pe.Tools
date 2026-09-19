import { type AppliedFilter, type DocumentRef } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";

export type FamiliesDraft = {
  placement: AppliedFilter["placementScope"];
  categories: string[];
  families: string[];
};

export interface FamiliesHost {
  categories(target: DocumentRef): Promise<string[]>;
  families(target: DocumentRef, draft: FamiliesDraft): Promise<string[]>;
  /** Every loaded family's name by its current element id, whatever the scope. */
  namesById(target: DocumentRef): Promise<Map<number, string>>;
}

export function createLiveFamiliesHost(): FamiliesHost {
  return {
    // The filter DTO's `[FieldOptions("category-names")]` domain, not a whole-catalog read.
    async categories(target) {
      const result = await callHostRpc(
        "revit.catalog.field-options",
        { sourceKey: "category-names" },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return result.items.map((item) => item.value).sort((a, b) => a.localeCompare(b));
    },
    async families(target, draft) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        {
          filter: {
            categoryNames: draft.categories,
            placementScope: draft.placement,
          },
          budget: { maxEntries: 5000 },
        },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return [
        ...new Set(
          result.families.flatMap((family) =>
            family.familyName.trim() ? [family.familyName] : [],
          ),
        ),
      ].sort((a, b) => a.localeCompare(b));
    },
    async namesById(target) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        { filter: {}, budget: { maxEntries: 5000 } },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return new Map(result.families.map((family) => [family.familyId, family.familyName]));
    },
  };
}
