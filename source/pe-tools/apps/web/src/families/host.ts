import { type AppliedFilter, type DocumentRef } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { FF_SPEC_SCHEMA, memberKey } from "#/host/familyfoundry";
import { isSpecOf } from "#/route/manifest";
import { podHost } from "#/route/pods";

export type FamiliesDraft = {
  placement: AppliedFilter["placementScope"];
  categories: string[];
  families: string[];
};

export interface FamiliesHost {
  categories(target: DocumentRef): Promise<string[]>;
  families(target: DocumentRef, draft: FamiliesDraft): Promise<string[]>;
  profiles(): Promise<string[]>;
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
    /** Every installed spec member, as picker ids (`pod:path`). */
    async profiles() {
      return (await podHost.list())
        .flatMap((pod) =>
          pod.members
            .filter((member) => isSpecOf(member.schema, FF_SPEC_SCHEMA))
            .map((member) => memberKey({ pod: pod.id, path: member.path })),
        )
        .sort((a, b) => a.localeCompare(b));
    },
  };
}
