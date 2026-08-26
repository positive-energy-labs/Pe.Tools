import {
  familyRouteState,
  settingsRouteState,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsFieldState,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";
import { docWriter, type Scope } from "#/state/route-store";

export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };
export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export interface EvidenceSlice {
  typeNames: string[];
  parameters: Array<{
    name: string;
    isShared?: boolean;
    propertiesGroup?: string | null;
    valuesPerType: Record<
      string,
      {
        value?: string | null;
        source?:
          | "AuthoredGlobal"
          | "AuthoredTypeOverride"
          | "Formula"
          | "RevitDefault"
          | "Unresolved";
        provenance?: "Exact" | "Inferred" | "Unresolved";
        formula?: string | null;
      }
    >;
  }>;
  diagnostics: unknown[];
  from: {
    origin: string;
    target: string;
    documentId: string;
    observedAt: string;
    documentVersionToken?: string;
    familyName: string;
    rfaPath?: string | null;
  };
}
export interface FamilyHost {
  sessions(): Promise<SessionFacts[]>;
  profile(target: string): Promise<string[]>;
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
    settingsApply: settings.apply,
    settingsCommand: settings.command,
    familyApply: family.apply,
    familyCommand: family.command,
  };
}
