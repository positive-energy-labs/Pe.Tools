import type { FamilyDocument, SettingsFieldState, SettingsSnapshot } from "@pe/agent-contracts";

export type FieldState = SettingsFieldState;
export type FamilySnapshot = SettingsSnapshot;
export type EvidenceSlice = NonNullable<FamilyDocument["evidence"]>;
