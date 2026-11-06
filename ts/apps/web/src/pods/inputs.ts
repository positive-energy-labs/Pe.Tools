import { podMemberSchema } from "@pe/agent-contracts";
import { selectedMember } from "./model";
import type { PodsPage } from "./page";

export const memberReadInput = podMemberSchema.nullable();
export const runsReadInput = podMemberSchema.partial({ path: true }).nullable();
export function runsInput(page: Pick<PodsPage, "pod" | "path" | "runs">) {
  const member = selectedMember(page);
  const pod = member?.pod || page.pod;
  return pod ? { pod, ...(page.runs !== "pod" && member && { path: member.path }) } : null;
}
