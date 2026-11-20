import type { FamilyDocument, SettingsSnapshot } from "@pe/agent-contracts";
export type FamilySnapshot = Omit<SettingsSnapshot, "member"> & {
  member?: SettingsSnapshot["member"];
};
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
