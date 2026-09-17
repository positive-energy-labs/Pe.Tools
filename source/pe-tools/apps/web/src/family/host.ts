import {
  type FamilyDocument,
  type PodMember,
  type SettingsFieldState,
  type SettingsSnapshot,
} from "@pe/agent-contracts";

import { isSpecOf } from "#/route/manifest";
import { podHost } from "#/route/pods";

/** The `$schema` path that says a member is a family model. */
export const FAMILY_MODEL_SCHEMA = "/schemas/settings/FamilyFoundry/models.json";
export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
export interface FamilyHost {
  profile(): Promise<PodMember[]>;
}

export function createLiveFamilyHost(): FamilyHost {
  return {
    async profile() {
      return (await podHost.list()).flatMap((pod) =>
        pod.members
          .filter((member) => isSpecOf(member.schema, FAMILY_MODEL_SCHEMA))
          .map((member) => ({ pod: pod.id, path: member.path })),
      );
    },
  };
}
