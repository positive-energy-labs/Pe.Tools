import {
  type FamilyDocument,
  type SettingsDocumentId,
  type SettingsFieldState,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";

export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };
export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
export interface FamilyHost {
  sessions(): Promise<SessionFacts[]>;
  profile(target: string): Promise<string[]>;
  settings(documentId: SettingsDocumentId): Promise<SettingsSnapshot>;
}

export function createLiveFamilyHost(): FamilyHost {
  return {
    async sessions() {
      return fromBridgeSessions((await callHostRpc("bridge.sessions.list", undefined)).sessions);
    },
    async profile(target) {
      const result = await callHostRpc(
        "settings.tree",
        {
          ...FAMILY_MODULE,
          subDirectory: "",
          recursive: true,
          includeFragments: false,
          includeSchemas: false,
        },
        { bridgeSessionId: target || undefined },
      );
      return result.files
        .filter((entry) => entry.relativePath.toLowerCase().endsWith(".json"))
        .map((entry) => entry.relativePath);
    },
    async settings(documentId) {
      const raw = await callHostRpc("settings.document.open", {
        documentId,
        includeComposedContent: true,
      });
      return {
        documentId,
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
