import {
  type FamilyDocument,
  type SettingsDocumentId,
  type SettingsFieldState,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";

export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };
export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
export interface FamilyHost {
  profile(target: string): Promise<string[]>;
  settings(documentId: SettingsDocumentId): Promise<SettingsSnapshot>;
}

export function createLiveFamilyHost(baseURL = ""): FamilyHost {
  return {
    async profile(target) {
      const result = await callHostRpc(
        "settings.tree",
        {
          ...FAMILY_MODULE,
          mode: "file",
          subDirectory: "",
          recursive: true,
          includeFragments: false,
          includeSchemas: false,
        },
        { bridgeSessionId: target || undefined, baseURL },
      );
      return result.files
        .filter((entry) => entry.relativePath.toLowerCase().endsWith(".json"))
        .map((entry) => entry.relativePath);
    },
    async settings(documentId) {
      const raw = await callHostRpc(
        "settings.document.open",
        {
          documentId,
          mode: "file",
          includeComposedContent: true,
        },
        { baseURL },
      );
      return {
        documentId,
        workspaceId: raw.metadata.workspaceId,
        path:
          raw.metadata.documentId.stableId ??
          (() => {
            throw new Error("settings.document.open returned no absolute document path.");
          })(),
        versionToken: raw.metadata.versionToken?.value ?? null,
        observedAt: new Date().toISOString(),
        rawContent: raw.rawContent,
        dependencies: raw.dependencies.map((d) => ({
          directivePath: d.directivePath,
          documentId: { ...d.documentId },
        })),
        composedContent: raw.composedContent ?? null,
        modifiedUtc: raw.metadata.modifiedUtc ?? null,
        validation: {
          isValid: raw.validation.isValid,
          issues: raw.validation.issues.map((issue) => ({ ...issue })),
        },
      };
    },
  };
}
