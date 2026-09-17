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
}

export function createLiveFamiliesHost(): FamiliesHost {
  return {
    async categories(target) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        { filter: { placementScope: "AllLoaded" }, budget: { maxEntries: 5000 } },
        { bridgeSessionId: target.session, openDocumentId: target.openId },
      );
      return [
        ...new Set(
          result.families.flatMap((family) =>
            family.categoryName?.trim() ? [family.categoryName] : [],
          ),
        ),
      ].sort((a, b) => a.localeCompare(b));
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
  };
}
