import {
  type FamilyDocument,
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
  };
}
