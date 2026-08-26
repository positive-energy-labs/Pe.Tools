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
      return (await callHostRpc("settings.tree", {
        moduleKey,
        rootKey,
        subDirectory: "",
        recursive: true,
        includeFragments: false,
        includeSchemas: false,
      })).files;
    },
    async schema(moduleKey, rootKey) {
      return (await callHostRpc("settings.schema", { moduleKey, rootKey })).schemaJson;
    },
    async open(documentId) {
      const result = await callHostRpc("settings.document.open", {
        documentId,
        includeComposedContent: true,
      });
      const path = result.metadata.documentId.stableId;
      if (!path) throw new Error("settings.document.open returned no absolute document path.");
      return {
        documentId,
        path,
        versionToken: result.metadata.versionToken?.value ?? null,
        observedAt: new Date().toISOString(),
        rawContent: result.rawContent,
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
