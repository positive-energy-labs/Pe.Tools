import { podMemberSchema } from "@pe/agent-contracts";
import { z } from "zod";
import { draftOf, selectedMember, type MemberRead } from "./model.ts";
import type { PodsPage } from "./page.ts";

export const memberReadInput = podMemberSchema.nullable();
export const runsReadInput = podMemberSchema.partial({ path: true }).nullable();
export const compositionReadInput = podMemberSchema.extend({ content: z.string() }).nullable();
/** Derive the exact bytes to check; parsing JSON must never reserialize the raw editor text. */
export function compositionInput(scope: Parameters<typeof draftOf>[0], member: MemberRead | null) {
  const ref = selectedMember(scope.page);
  if (!ref || !member || !ref.path.endsWith(".json")) return null;
  try {
    const content = draftOf(scope, member);
    JSON.parse(content);
    return { ...ref, content };
  } catch {
    return null;
  }
}
export function runsInput(page: Pick<PodsPage, "pod" | "path" | "runs">) {
  const member = selectedMember(page);
  const pod = member?.pod || page.pod;
  return pod ? { pod, ...(page.runs !== "pod" && member && { path: member.path }) } : null;
}
