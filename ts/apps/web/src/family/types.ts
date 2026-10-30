import type { FamilyDocument, SettingsFieldState, SettingsSnapshot } from "@pe/agent-contracts";

export type FieldState = SettingsFieldState;
export type FamilySnapshot = Omit<SettingsSnapshot, "member"> & {
  member?: SettingsSnapshot["member"];
};
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
