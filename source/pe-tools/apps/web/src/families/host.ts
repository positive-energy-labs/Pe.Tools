import { type AppliedScope } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { FF_PROFILE_MODULE, type FfProjectData } from "#/host/familyfoundry";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";

export type FamiliesDraft = {
  placement: AppliedScope["placementScope"];
  categories: string[];
  families: string[];
};

export interface FamiliesHost {
  sessions(): Promise<SessionFacts[]>;
  categories(target: string): Promise<string[]>;
  families(target: string, draft: FamiliesDraft): Promise<string[]>;
  profiles(): Promise<string[]>;
  project(target: string, familyIds: number[]): Promise<FfProjectData>;
  openPath(target: string, path: string): Promise<unknown>;
}

export function createLiveFamiliesHost(): FamiliesHost {
  return {
    async sessions() {
      return fromBridgeSessions((await callHostRpc("bridge.sessions.list", undefined)).sessions);
    },
    async categories(target) {
      const result = await callHostRpc(
        "revit.catalog.loaded-families",
        { filter: { placementScope: "AllLoaded" }, budget: { maxEntries: 5000 } },
        { bridgeSessionId: target || undefined },
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
        { bridgeSessionId: target || undefined },
      );
      return [
        ...new Set(
          result.families.flatMap((family) =>
            family.familyName.trim() ? [family.familyName] : [],
          ),
        ),
      ].sort((a, b) => a.localeCompare(b));
    },
    async profiles() {
      const result = await callHostRpc("settings.tree", {
        ...FF_PROFILE_MODULE,
        subDirectory: "",
        recursive: true,
        includeFragments: false,
        includeSchemas: false,
      });
      return result.files
        .filter((entry) => entry.relativePath.toLowerCase().endsWith(".json"))
        .map((entry) => entry.relativePath)
        .sort((a, b) => a.localeCompare(b));
    },
    project: (target, familyIds) =>
      callHostRpc("familyfoundry.project", { familyIds }, { bridgeSessionId: target || undefined }),
    openPath: (target, path) =>
      callHostRpc("host.shell.open", { path }, { bridgeSessionId: target || undefined }),
  };
}
