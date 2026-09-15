import type { SettingsDocumentId, SettingsSnapshot } from "@pe/agent-contracts";
import type {
  SettingsFileEntry,
  SettingsWorkspaceDescriptor,
} from "@pe/host-contracts/operation-types";

import { callHostRpc } from "#/host/client";
export interface SettingsHost {
  workspaces(): Promise<readonly SettingsWorkspaceDescriptor[]>;
  tree(moduleKey: string, rootKey: string): Promise<readonly SettingsFileEntry[]>;
  schema(moduleKey: string, rootKey: string): Promise<string>;
  open(documentId: SettingsDocumentId): Promise<SettingsSnapshot>;
}

export function createLiveSettingsHost(): SettingsHost {
  return {
    async workspaces() {
      return (await callHostRpc("settings.workspaces", undefined)).workspaces;
    },
    async tree(moduleKey, rootKey) {
      return (
        await callHostRpc("settings.tree", {
          moduleKey,
          rootKey,
          mode: "file",
          subDirectory: "",
          recursive: true,
          includeFragments: true,
          includeSchemas: false,
        })
      ).files;
    },
    async schema() {
      return "";
    },
    async open(documentId) {
      const result = await callHostRpc("settings.document.open", {
        documentId,
        mode: "file",
        includeComposedContent: true,
      });
      const path = result.metadata.documentId.stableId;
      if (!path) throw new Error("settings.document.open returned no absolute document path.");
      return {
        documentId,
        workspaceId: result.metadata.workspaceId,
        path,
        versionToken: result.metadata.versionToken?.value ?? null,
        observedAt: new Date().toISOString(),
        rawContent: result.rawContent,
        dependencies: result.dependencies.map((d) => ({
          directivePath: d.directivePath,
          documentId: { ...d.documentId },
        })),
        composedContent: result.composedContent ?? null,
        modifiedUtc: result.metadata.modifiedUtc ?? null,
        validation: {
          isValid: result.validation.isValid,
          issues: result.validation.issues.map((issue) => ({ ...issue })),
        },
      };
    },
  };
}
