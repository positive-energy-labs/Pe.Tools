import {
  familyRouteState,
  settingsRouteState,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type FamilyDocument,
  type SettingsDocumentId,
  type SettingsFieldState,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";
import { docWriter, type Scope } from "#/state/route-store";

export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };
export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
export interface FamilyHost {
  sessions(): Promise<SessionFacts[]>;
  profile(target: string): Promise<string[]>;
  settings(documentId: SettingsDocumentId): Promise<SettingsSnapshot>;
  settingsApply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
  settingsCommand(
    name: "open" | "save",
    input?: Record<string, unknown>,
  ): Promise<RouteStateWriteResult>;
  familyApply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
  familyCommand(
    name: "capture_evidence" | "build_evidence",
    input?: Record<string, unknown>,
  ): Promise<RouteStateWriteResult>;
}

export function createLiveFamilyHost(scope: Scope): FamilyHost {
  const settings = docWriter(settingsRouteState, scope);
  const family = docWriter(familyRouteState, scope);
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
        composedContent: raw.composedContent ?? null,
        modifiedUtc: raw.metadata.modifiedUtc ?? null,
        validation: {
          isValid: raw.validation.isValid,
          issues: raw.validation.issues.map((issue) => ({ ...issue })),
        },
      };
    },
    settingsApply: settings.apply,
    settingsCommand: settings.command,
    familyApply: family.apply,
    familyCommand: family.command,
  };
}
