import type { PodMember, ParsedDocView } from "@pe/agent-contracts";
export interface FamilySpecReading {
  member: PodMember;
  doc: ParsedDocView;
}
export const readingValue = <T>(
  value: { value?: unknown; previous?: unknown } | undefined,
): T | null => (value?.value ?? value?.previous ?? null) as T | null;
